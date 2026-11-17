import {digest,type Article,type ArticleBody} from './model';
import {safeHtml} from './content';
import {withWorkspaceLock,type Repository} from './storage';
import type {RssService} from './service';
import {IndexTranslator,PartialTranslationError,TranslationError,TRANSLATION,unit,needsTranslation,legacyPlan,legacyContent,type Unit,type TranslationCache,type TranslationResult} from './translation-protocol';
import {translationPlan,unitHash,plainTranslation,hasEnglish,hasEmphasis} from './translation-plan';
export interface TranslationProgress {done:number;total:number;result:TranslationResult}
interface Stage {fingerprint:string;keys:string[];state:'partial'|'ready'|'failed';error?:string;retryAt?:number}
interface RecordV2 {version:2;model:string;target:string;rules:number;entries:Record<string,{value:string;updated:number}>;header?:Stage;body?:Stage;migration?:{oldRules:number;reused:number;unmapped:string[]};updated:number}
interface Job {key:string;article:Article;result:TranslationResult;record:RecordV2;stage:'header'|'body';callbacks:Set<(p:TranslationProgress)=>void>;resolve:(r:TranslationResult)=>void;reject:(e:Error)=>void;promise:Promise<TranslationResult>;attempt:number;retryAt:number;later:boolean;reader:boolean;importing?:boolean;urgent:string[];cancelled?:boolean}
export class TranslationService {
  private records=new Map<string,RecordV2>();private loads=new Map<string,Promise<RecordV2>>();private headers=new Map<string,{title?:string;summary?:string;signature?:string}>();
  private jobs=new Map<string,Job>();private listeners=new Set<(id:string)=>void>();private running=false;private closed=false;private timer?:ReturnType<typeof setTimeout>;private blockedUntil=0;
  private rss?:RssService;private foreground?:string;private viewport:string[]=[];private laterLoading=new Set<string>();private laterTail:Promise<unknown>=Promise.resolve();private resumeTimer?:ReturnType<typeof setInterval>;
  trace?:(e:Record<string,unknown>)=>void;
  constructor(readonly repo:Repository,private client:Pick<IndexTranslator,'translate'>,private wait=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms))){}
  subscribe(fn:(id:string)=>void):()=>void{this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  isPending(id:string):boolean{return [...this.jobs.values()].some(j=>j.article.id===id&&!j.cancelled);}
  header(id:string):{title?:string;summary?:string}|undefined{return this.headers.get(id);}
  async retry(id:string):Promise<void>{const r=await this.record(id);if(r.body){delete r.body.retryAt;delete r.body.error;r.body.state='partial';}await this.save(id,r);}
  private emit(id:string):void{if(!this.closed)this.listeners.forEach(f=>f(id));}
  connect(rss:RssService):void{this.rss=rss;rss.articlesChanged=articles=>this.ensureHeaders(articles);rss.laterChanged=a=>{if(a.later)this.enqueueLater(a);else this.cancelLater(a.id);};this.resumeLater();this.resumeTimer=setInterval(()=>this.resumeLater(),60000);}
  resumeLater():void{if(!this.closed)this.repo.state.articles.filter(a=>a.later).forEach(a=>this.enqueueLater(a));}
  private enqueueLater(a:Article):void{
    if(!this.rss||this.closed||this.laterLoading.has(a.id)||[...this.jobs.values()].some(j=>j.article.id===a.id&&j.stage==='body'))return;
    this.laterLoading.add(a.id);this.laterTail=this.laterTail.catch(()=>{}).then(async()=>{
      const live=this.repo.state.articles.find(x=>x.id===a.id);if(this.closed||!live?.later)return;const record=await this.record(a.id);if((record.body?.retryAt??0)>Date.now())return;
      const body=await this.rss!.read(live);if(this.closed||!this.repo.state.articles.find(x=>x.id===a.id)?.later)return;
      void this.translate(live,body,undefined,'later').catch(()=>{});
    }).catch(async e=>{if(!this.closed){const r=await this.record(a.id);r.body={fingerprint:r.body?.fingerprint??'',keys:r.body?.keys??[],state:'failed',error:(e as Error).message,retryAt:Date.now()+300000};await this.save(a.id,r);}}).finally(()=>this.laterLoading.delete(a.id));
  }
  private cancelLater(id:string):void{for(const j of this.jobs.values())if(j.article.id===id&&j.stage==='body'){j.later=false;if(!j.reader&&!j.importing)j.cancelled=true;}void this.pump();}
  releaseReader(id?:string):void{if(!id||this.foreground===id){this.foreground=undefined;this.viewport=[];}for(const j of this.jobs.values())if(j.stage==='body'&&(!id||j.article.id===id)){j.reader=false;if(!j.later&&!j.importing)j.cancelled=true;}void this.pump();}
  focus(id:string,parts:string[]):void{this.foreground=id;this.viewport=parts;for(const j of this.jobs.values())if(j.article.id===id&&j.stage==='body'){j.reader=true;j.cancelled=false;j.urgent=parts;}void this.pump();}
  ensureHeaders(articles:Article[]):void{for(const a of articles)void this.translateHeader(a).catch(()=>{});}
  private async record(id:string):Promise<RecordV2>{
    const known=this.records.get(id);if(known)return known;const pending=this.loads.get(id);if(pending)return pending;
    const work=(async()=>{const raw=await this.repo.io.load(`translation-${id}.json`) as RecordV2|TranslationCache|undefined;
      if(raw&&raw.version!==1&&raw.version!==2)throw Error('翻译缓存格式无法识别，已保留原文件。');
      if(raw?.version===2){if(!raw.entries||raw.model!==TRANSLATION.model||raw.target!==TRANSLATION.target)throw Error('翻译缓存模型或格式不匹配，已保留数据。');this.records.set(id,raw);return raw;}
      if(raw?.version===1&&!await this.repo.io.load(`translation-v1-${id}.json`))await this.repo.io.save(`translation-v1-${id}.json`,raw);
      const next:RecordV2={version:2,model:TRANSLATION.model,target:TRANSLATION.target,rules:5,entries:{},updated:Date.now()};this.records.set(id,next);return next;
    })().finally(()=>this.loads.delete(id));this.loads.set(id,work);return work;
  }
  private async save(id:string,r:RecordV2):Promise<void>{
    if(this.closed)return;r.updated=Date.now();await withWorkspaceLock('translation-file:'+id,async()=>{
      const disk=await this.repo.io.load(`translation-${id}.json`) as RecordV2|undefined;const next=structuredClone(r);
      if(disk?.version===2&&disk.model===r.model&&disk.target===r.target)next.entries={...disk.entries,...next.entries};
      await this.repo.io.save(`translation-${id}.json`,next);Object.assign(r,next);
    });
  }
  private cache(id:string,fingerprint:string,units:Unit[],r:RecordV2):TranslationCache{const parts=Object.fromEntries(units.filter(u=>r.entries[u.hash!]).map(u=>[u.id,r.entries[u.hash!].value])),stage=r.body?.fingerprint===fingerprint?r.body:r.header?.fingerprint===fingerprint?r.header:undefined;return{version:1,key:id+':'+fingerprint,articleId:id,fingerprint,model:r.model,target:r.target,rules:5,parts,updated:r.updated,state:units.every(u=>parts[u.id]!==undefined)?'ready':stage?.state==='failed'?'failed':'partial',error:stage?.error};}
  private async index(j:Job,state:'pending'|'ready'|'failed',error?:string):Promise<void>{if(j.stage==='body'&&!this.closed)await this.repo.update(s=>{const a=s.articles.find(a=>a.id===j.article.id);if(a&&a.contentVersion===j.article.contentVersion)a.translation={state,sourceVersion:a.contentVersion,error};});}
  private async migration(a:Article,body:ArticleBody,result:TranslationResult,r:RecordV2):Promise<void>{
    if(r.migration)return;const old=await this.repo.io.load(`translation-v1-${a.id}.json`) as TranslationCache|undefined;if(!old)return;
    r.migration={oldRules:old.rules,reused:0,unmapped:Object.keys(old.parts??{})};const legacy=await legacyPlan(a,body),reused=new Set<string>();
    if(old.rules<3||old.model!==TRANSLATION.model||old.target!==TRANSLATION.target||old.fingerprint!==legacy.fingerprint){await this.save(a.id,r);return;}
    const source=new DOMParser().parseFromString(legacy.html,'text/html'),translated=new DOMParser().parseFromString(legacyContent({plan:legacy,cache:old}).html,'text/html');
    const structure=(html:string)=>{const d=new DOMParser().parseFromString(html,'text/html');d.querySelectorAll('[data-rss-text]').forEach(el=>el.replaceWith(...el.childNodes));return [...d.body.querySelectorAll('*')].map(el=>[el.tagName,[...el.attributes].filter(a=>!a.name.startsWith('data-rss')).map(a=>[a.name,a.value])]);};
    for(const u of result.plan.units){let value:string|undefined;
      if(hasEmphasis(u))continue; // Text-node translations cannot safely establish semantic emphasis boundaries.
      if(u.id==='title-0'){const ids=legacy.units.filter(x=>x.id.startsWith('title-'));if(ids.length&&ids.every(x=>old.parts[x.id]!==undefined)){value=ids.map(x=>old.parts[x.id]).join('');ids.forEach(x=>reused.add(x.id));}}
      else for(const block of source.querySelectorAll('[data-rss-block]')){
        if(block.textContent?.trim()!==u.text.trim()||JSON.stringify(structure(block.innerHTML))!==JSON.stringify(structure(u.html??'')))continue;
        const ids=[...block.querySelectorAll<HTMLElement>('[data-rss-text]')].flatMap(s=>legacy.units.filter(x=>x.id.startsWith(s.dataset.rssText+'-')));if(!ids.length||ids.some(x=>old.parts[x.id]===undefined))continue;
        const target=translated.querySelector(`[data-rss-block="${block.getAttribute('data-rss-block')}"]`)!.cloneNode(true) as Element;target.querySelectorAll('[data-rss-text]').forEach(s=>s.replaceWith(...s.childNodes));value=safeHtml(target.innerHTML,a.url);ids.forEach(x=>reused.add(x.id));break;
      }
      if(value!==undefined){r.entries[u.hash!]={value,updated:Date.now()};r.migration.reused++;}
    }r.migration.unmapped=r.migration.unmapped.filter(id=>!reused.has(id));await this.save(a.id,r);
  }
  async prepare(a:Article,body:ArticleBody):Promise<TranslationResult>{
    const external=body.apiChoice==='original'?{html:body.html,title:a.title}:body.apiChoice?body.api?.[body.apiChoice]:body.api?.rewrite?.html?body.api.rewrite:body.api?.translation;
    if(external?.html){const fingerprint=await digest(external.html),title=body.apiChoice==='original'?a.title:a.titleZh||external.title||a.title;return{plan:{id:a.id,title,html:external.html,fingerprint,units:[],needed:false},cache:{version:1,key:a.id,articleId:a.id,fingerprint,model:'third-party',target:'zh-CN',rules:1,parts:{'title-0':title},updated:Date.now(),state:'ready'}};}
    const plan=await translationPlan(a.titleZh?{...a,title:a.titleZh}:a,body),r=await this.record(a.id),result={plan,cache:this.cache(a.id,plan.fingerprint,plan.units,r)};await withWorkspaceLock('translation-migration:'+a.id,()=>this.migration(a,body,result,r));this.fill(result,r);return result;}
  async translateHeader(a:Article):Promise<TranslationResult>{
    const units:Unit[]=[];if(!a.titleZh&&hasEnglish(a.title))units.push(unit('title-0',a.title));if(!a.summaryZh&&a.summary&&hasEnglish(a.summary))units.push(unit('summary-0',a.summary));await Promise.all(units.map(async u=>u.hash=await unitHash(u)));
    const fingerprint=await digest(a.title+'\n'+a.summary),r=await this.record(a.id),result:TranslationResult={plan:{id:a.id,title:a.title,html:'',fingerprint,units,needed:units.length>0},cache:this.cache(a.id,fingerprint,units,r)};
    const old=await this.repo.io.load(`translation-v1-${a.id}.json`) as TranslationCache|undefined,title=units.find(u=>u.id==='title-0');
    if(title&&!r.entries[title.hash!]&&old&&old.rules>=3&&old.model===TRANSLATION.model){const original=await this.repo.body(a.id);if(original){const legacy=await legacyPlan(a,original);if(legacy.fingerprint===old.fingerprint){const ts=legacy.units.filter(u=>u.id.startsWith('title-'));if(ts.length&&ts.every(u=>old.parts[u.id]!==undefined))r.entries[title.hash!]={value:ts.map(u=>old.parts[u.id]).join(''),updated:Date.now()};}}}
    this.fill(result,r);this.publishHeader(a,result);return this.enqueue(a,result,r,'header',false);
  }
  translate(a:Article,body:ArticleBody,progress?:(p:TranslationProgress)=>void,reason:'reader'|'later'|'inbox'='reader'):Promise<TranslationResult>{if(reason==='reader')this.foreground=a.id;return this.prepare(a,body).then(async result=>{if(result.cache.model==='third-party')return result;const saved=!!this.repo.state.articles.find(x=>x.id===a.id)?.later;if(reason==='reader'&&this.foreground!==a.id&&!saved)return result;return this.enqueue(a,result,await this.record(a.id),'body',reason==='later'||saved,progress,reason==='inbox');});}
  private fill(result:TranslationResult,r:RecordV2):void{Object.assign(result.cache,this.cache(result.plan.id,result.plan.fingerprint,result.plan.units,r));}
  private publishHeader(a:Article,result:TranslationResult):void{const live=this.repo.state.articles.find(x=>x.id===a.id);if(live&&(live.title!==a.title||live.summary!==a.summary))return;const signature=a.title+'\n'+a.summary,known=this.headers.get(a.id),prior=known?.signature===signature?known:{signature};for(const u of result.plan.units)if(['title-0','summary-0'].includes(u.id)&&result.cache.parts[u.id]!==undefined)Object.assign(prior,{[u.id==='title-0'?'title':'summary']:plainTranslation(u,result.cache.parts[u.id])});this.headers.set(a.id,prior);this.emit(a.id);}
  private async enqueue(a:Article,result:TranslationResult,r:RecordV2,stage:'header'|'body',later:boolean,progress?:(p:TranslationProgress)=>void,importing=false):Promise<TranslationResult>{
    if(this.closed)throw Error('翻译已停止。');this.fill(result,r);progress?.({done:Object.keys(result.cache.parts).length,total:result.plan.units.length,result});if(!result.plan.needed||result.cache.state==='ready'){if(r[stage]?.fingerprint!==result.plan.fingerprint||r[stage]?.state!=='ready'){r[stage]={fingerprint:result.plan.fingerprint,keys:result.plan.units.map(u=>u.hash!),state:'ready'};await this.save(a.id,r);}if(stage==='body'&&this.repo.state.articles.find(x=>x.id===a.id)?.translation?.state!=='ready')await this.repo.update(s=>{const live=s.articles.find(x=>x.id===a.id);if(live&&live.contentVersion===a.contentVersion)live.translation={state:'ready',sourceVersion:a.contentVersion};});return result;}
    const key=stage+':'+a.id+':'+result.plan.fingerprint+':'+result.plan.title,existing=this.jobs.get(key);if(existing){if(progress)existing.callbacks.add(progress);existing.later||=later;existing.importing||=importing;existing.reader||=stage==='body'&&this.foreground===a.id;existing.cancelled=false;return existing.promise;}
    let resolve!:(r:TranslationResult)=>void,reject!:(e:Error)=>void;const promise=new Promise<TranslationResult>((res,rej)=>{resolve=res;reject=rej;});const prior=r[stage];
    if(prior?.fingerprint===result.plan.fingerprint&&prior.state==='failed'&&(prior.retryAt??0)>Date.now())throw Error(prior.error||'翻译失败，正在冷却。');
    const j:Job={key,article:a,result,record:r,stage,callbacks:new Set(progress?[progress]:[]),resolve,reject,promise,attempt:0,retryAt:prior?.fingerprint===result.plan.fingerprint?prior.retryAt??0:0,later,importing,reader:stage==='body'&&this.foreground===a.id,urgent:this.foreground===a.id?this.viewport:[]};
    this.jobs.set(key,j);this.emit(a.id);r[stage]={fingerprint:result.plan.fingerprint,keys:result.plan.units.map(u=>u.hash!),state:'partial',retryAt:j.retryAt};try{await this.save(a.id,r);await this.index(j,'pending');}catch(e){this.jobs.delete(key);this.emit(a.id);resolve(result);throw e;}void this.pump();return promise;
  }
  private pending(j:Job):Unit[]{return j.result.plan.units.filter(u=>!j.record.entries[u.hash!]);}
  private rank(j:Job):number{if(j.stage==='header')return 1;if(j.reader&&this.foreground===j.article.id)return this.pending(j).some(u=>u.id==='title-0'||(j.urgent.length?j.urgent.includes(u.id):j.result.plan.units.indexOf(u)<5))?0:1.5;return j.importing?1.5:2;}
  private async pump():Promise<void>{
    if(this.running||this.closed)return;this.running=true;clearTimeout(this.timer);
    try{while(!this.closed){
      for(const j of this.jobs.values())if(j.cancelled){this.jobs.delete(j.key);this.emit(j.article.id);j.resolve(j.result);}
      const now=Date.now(),j=[...this.jobs.values()].filter(j=>j.retryAt<=now).sort((a,b)=>this.rank(a)-this.rank(b))[0];
      if(!j||this.blockedUntil>now){const next=Math.min(...[...this.jobs.values()].map(j=>Math.max(j.retryAt,this.blockedUntil)));if(Number.isFinite(next))this.timer=setTimeout(()=>void this.pump(),Math.max(20,next-now));break;}
      this.fill(j.result,j.record);let pending=this.pending(j);
      if(!pending.length){j.record[j.stage]!.state='ready';delete j.record[j.stage]!.error;delete j.record[j.stage]!.retryAt;await this.save(j.article.id,j.record);await this.index(j,'ready');this.jobs.delete(j.key);this.emit(j.article.id);j.resolve(j.result);continue;}
      if(j.reader){const urgent=new Set(j.urgent);pending.sort((a,b)=>Number(b.id==='title-0'||urgent.has(b.id))-Number(a.id==='title-0'||urgent.has(a.id)));}
      const firstScreen=this.rank(j)===0,batch:Unit[]=[],hashes=new Set<string>();let size=0;for(const u of pending){if(hashes.has(u.hash!))continue;if(batch.length&&(size+u.source.length>(firstScreen?900:1450)||batch.length>=(firstScreen?4:12)))break;hashes.add(u.hash!);batch.push(u);size+=u.source.length;}
      const start=performance.now();this.trace?.({event:'batchStart',article:j.article.id,stage:j.stage,priority:this.rank(j),units:batch.length,chars:size});
      try{const values=await this.client.translate(batch);await this.commit(j,batch,values);j.attempt=0;j.retryAt=0;this.trace?.({event:'batchEnd',article:j.article.id,stage:j.stage,ms:performance.now()-start,ok:true});}
      catch(error){if(this.closed)break;if(error instanceof PartialTranslationError)await this.commit(j,batch,error.parts);j.attempt++;const stop=(error instanceof TranslationError&&!error.retryable)||j.attempt>=3,delay=Math.max(error instanceof TranslationError?error.delay:0,1000*2**(j.attempt-1));if(error instanceof TranslationError&&error.delay)this.blockedUntil=Date.now()+delay;this.trace?.({event:'batchEnd',article:j.article.id,stage:j.stage,ms:performance.now()-start,ok:false,error:(error as Error).message});
        if(stop){const state=j.record[j.stage]!;Object.assign(state,{state:'failed',error:(error as Error).message,retryAt:Date.now()+300000});j.result.cache.state='failed';j.result.cache.error=state.error;await this.save(j.article.id,j.record);await this.index(j,'failed',state.error);this.jobs.delete(j.key);this.emit(j.article.id);j.reject(error as Error);}
        else{j.retryAt=Date.now()+delay;await this.wait(delay);j.retryAt=0;}
      }await this.wait(150);
    }}catch(error){for(const job of this.jobs.values())job.reject(error as Error);this.jobs.clear();}finally{this.running=false;}
  }
  private async commit(j:Job,batch:Unit[],values:Record<string,string>):Promise<void>{if(this.closed)return;for(const u of batch)if(typeof values[u.id]==='string'&&values[u.id].trim())j.record.entries[u.hash!]={value:values[u.id],updated:Date.now()};await this.save(j.article.id,j.record);this.fill(j.result,j.record);this.publishHeader(j.article,j.result);const p={done:Object.keys(j.result.cache.parts).length,total:j.result.plan.units.length,result:j.result};j.callbacks.forEach(f=>f(p));}
  async testConnection():Promise<string>{const a:Article={id:'connection-test',sourceId:'',guid:'',url:'',title:'Reading helps us understand the world.',summary:'',author:'',published:0,tags:[],later:false,contentKind:'summary'};return(await this.translateHeader(a)).cache.parts['title-0'];}
  dispose():void{this.closed=true;clearTimeout(this.timer);clearInterval(this.resumeTimer);if(this.rss){this.rss.articlesChanged=undefined;this.rss.laterChanged=undefined;}for(const j of this.jobs.values())j.resolve(j.result);this.jobs.clear();this.listeners.clear();}
}
