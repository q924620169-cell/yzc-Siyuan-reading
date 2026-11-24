import {ApiSources,type ApiServiceConfig} from './api-source';
import {canonicalUrl,digest,findIdentity,sourceGroups,mergeArticles,quality,type Source,type Article,type ArticleBody} from './model';
import {parseOpml} from './feed';
import {extractPage,firstBodyImage,pageCover,sameImage,plain,safeHtml} from './content';
import {header,type RemoteClient} from './kernel';
import {withWorkspaceLock,type Repository} from './storage';
import {SourceRegistry,resolveInput,type Discovery,type SubscriptionCandidate,type SubscriptionPlan} from './sources';

export const retryDelay=(attempts:number):number=>Math.min(6*3600_000,5*60_000*2**Math.min(Math.max(attempts-1,0),7));
/** Complete content wins over summaries. Same-quality bodies only replace with equal/greater text. */
export function betterBody(old:ArticleBody|undefined,next:ArticleBody):ArticleBody{
  if(!old)return next;
  if(quality(next.kind)<quality(old.kind))return old;
  if(old.kind!=='summary'&&plain(next.html).length<plain(old.html).length)return old;
  if(quality(next.kind)===quality(old.kind)&&plain(next.html).length<plain(old.html).length)return old;
  return next;
}
interface Prepared {source:Source;items:Discovery['items']}
export class RssService {
  private refreshListeners=new Set<()=>void>();
  private refreshScopes=new Map<string,string[]>();
  subscribeRefresh(fn:()=>void):()=>void{this.refreshListeners.add(fn);return()=>this.refreshListeners.delete(fn);}
  isRefreshing(ids:string[]):boolean{return [...this.refreshScopes.values()].some(scope=>scope.some(id=>ids.includes(id)));}
  private emitRefresh():void{this.refreshListeners.forEach(fn=>fn());}
  articlesChanged?:(articles:Article[])=>void;
  laterChanged?:(article:Article)=>void;
  private refreshing=new Map<string,Promise<{failed:number;total:number;skipped:number}>>();
  private sourceRefreshes=new Map<string,Promise<'ok'|'failed'|'skipped'>>();
  private activeRefreshes=0;private refreshWaiters:(()=>void)[]=[];
  private reads=new Map<string,Promise<ArticleBody>>();
  private previews=new Map<string,Promise<string|undefined>>();
  private previewQueue:Promise<void>[]=[];
  private previewCursor=0;
  trace?:(event:Record<string,unknown>)=>void;
  private closed=false;
  readonly apiSources:ApiSources;
  constructor(readonly repo:Repository,private remote:RemoteClient,private registry=new SourceRegistry()){this.apiSources=new ApiSources(repo,remote);}
  async addApi(serviceId:string,choices:{id:string;name:string;category?:string;platform?:string}[],group:string|string[],listUrl?:string):Promise<void>{
    const prepared:Prepared[]=[];for(const choice of choices){const id=await digest("api:"+serviceId+":"+choice.id);if(this.repo.state.sources.some(s=>s.id===id))continue;const c=await this.apiSources.config(serviceId),source:Source={id,url:c.baseUrl,title:choice.name,group:(Array.isArray(group)?group[0]:group)||"未分组",groups:Array.isArray(group)?group:[group].filter(Boolean),tags:[],type:"api",api:{serviceId,sourceKey:choice.id,category:choice.category,platform:choice.platform,listUrl}};const result=await this.apiSources.listing(source);source.api!.cursor=result.cursor;prepared.push({source,items:result.items});}await this.commit(prepared,true);
  }
  async moreApi(id:string):Promise<void>{const source=this.repo.state.sources.find(s=>s.id===id);if(!source?.api||source.paused)return;const r=await this.apiSources.listing(source,true);await this.commit([{source:{...source,api:{...source.api,cursor:r.cursor}},items:r.items}]);}
  async setSourcePaused(id:string,paused:boolean):Promise<void>{
    await withWorkspaceLock('ingestion',()=>this.repo.update(s=>{
      const source=s.sources.find(x=>x.id===id);
      if(!source)throw Error('该来源已不存在。');
      if(paused)source.paused=true;
      else{delete source.paused;delete source.retryAfter;delete source.failures;delete source.error;}
    }));
  }
  async removeSource(id:string):Promise<void>{
    await withWorkspaceLock('ingestion',async()=>{
      const removed:string[]=[];
      await this.repo.update(s=>{
        s.sources=s.sources.filter(source=>source.id!==id);
        s.articles=s.articles.filter(article=>{
          const previous=article.sourceIds??[article.sourceId];
          if(!previous.includes(id))return true;
          const remaining=previous.filter(source=>source!==id);
          if(!remaining.length){removed.push(article.id);return false;}
          article.sourceIds=remaining;
          if(article.sourceId===id)article.sourceId=remaining[0];
          article.records=article.records?.filter(record=>record.sourceId!==id);
          return true;
        });
      });
      for(const article of removed)await this.repo.removeBody(article);
    });
  }
  async prepare(input:string):Promise<SubscriptionPlan>{
    const plan=await resolveInput(input,this.remote);
    return{...plan,candidates:plan.candidates.map(c=>({...c,existing:this.repo.state.sources.some(s=>s.url===c.url)}))};
  }
  private async fetchSource(candidate:SubscriptionCandidate,tags:string[]):Promise<Prepared>{
    const url=canonicalUrl(candidate.url);if(!url)throw Error('请输入有效的 HTTP(S) 订阅地址。');
    const id=await digest(url),response=await this.remote.get(url);
    const source:Source={id,url,type:'rss',title:candidate.title.trim(),group:candidate.groups?.[0]??(candidate.group.trim()||'未分组'),groups:candidate.groups??[candidate.group.trim()||'未分组'],tags,
      fetchedAt:Date.now(),etag:header(response,'etag'),modified:header(response,'last-modified')};
    const parsed=await this.registry.get(source.type).discover(response,source);
    source.title||=parsed.title;return{source,items:parsed.items};
  }
  async add(url:string,title:string,group:string|string[],tags:string[]):Promise<void>{
    url=canonicalUrl(url);if(this.repo.state.sources.some(s=>s.url===url))throw Error('该订阅源已存在。');
    const prepared=await this.fetchSource({url,title,group:Array.isArray(group)?group[0]??'未分组':group,...(Array.isArray(group)?{groups:group}:{})},tags);
    const added=await this.commit([prepared],true);if(!added)throw Error('该订阅源已存在。');
  }
  /** Call only after preview confirmation. All fetched successes publish in one index commit. */
  async importCandidates(candidates:SubscriptionCandidate[]):Promise<{added:number;failed:string[]}>{
    const prepared:Prepared[]=[],failed:string[]=[];
    const seen=new Set(this.repo.state.sources.map(s=>s.url));
    for(const candidate of candidates){
      if(this.closed)throw Error('RSS 已关闭。');
      if(seen.has(candidate.url))continue;seen.add(candidate.url);
      try{prepared.push(await this.fetchSource(candidate,[]));}catch(e){failed.push(`${candidate.title||candidate.url}：${(e as Error).message}`);}
    }
    const added=await this.commit(prepared,true);return{added,failed};
  }
  async importOpml(input:string):Promise<{added:number;failed:string[]}>{return this.importCandidates(parseOpml(input));}
  private async commit(prepared:Prepared[],adding=false):Promise<number>{
    return withWorkspaceLock('ingestion',async()=>{
      if(this.closed)throw Error('RSS 已关闭。');
      await this.repo.load();
      const usable=prepared.filter(p=>adding?!this.repo.state.sources.some(s=>s.id===p.source.id):this.repo.state.sources.some(s=>s.id===p.source.id&&!s.paused));
      const articles=[...this.repo.state.articles],positions=new Map(articles.map((a,i)=>[a.id,i]));const incoming:Article[]=[];
      for(const p of usable)for(const item of p.items){
        const matched=item.article.api?articles.find(a=>a.sourceId===item.article.sourceId&&a.api?.entryId===item.article.api!.entryId):findIdentity(articles.filter(a=>!a.api),item.article),id=matched?.id??item.article.id;
        const previous=await this.repo.body(id),chosen=betterBody(previous,item.body);if(previous?.api)chosen.api=previous.api;
        const version=await digest(`${item.article.title}\n${chosen.kind}\n${chosen.html}`);
        const a:Article={...item.article,id,contentKind:chosen.kind,contentVersion:version,
          contentFetch:chosen.kind==='summary'?matched?.contentFetch??item.article.contentFetch:{state:'available',attempts:0}};
        if(matched?.contentVersion!==version)await this.repo.saveBody(id,chosen);
        if(matched?.later&&!await this.repo.savedBody(id))await this.repo.saveSnapshot(id,chosen);
        incoming.push(a);
        const index=positions.get(id);
        if(index!==undefined)articles[index]=mergeArticles([articles[index]],[a])[0];
        else{positions.set(id,articles.length);articles.push(a);}
      }
      await this.repo.update(s=>{
        for(const p of usable){
          const live=s.sources.find(x=>x.id===p.source.id);
          if(adding){if(!live)s.sources.push(p.source);}
          else if(live)Object.assign(live,{api:p.source.api,etag:p.source.etag,modified:p.source.modified,fetchedAt:p.source.fetchedAt,error:undefined,failures:0,retryAfter:undefined});
        }
        const liveIds=new Set(s.sources.map(x=>x.id));
        s.articles=mergeArticles(s.articles,incoming.filter(a=>liveIds.has(a.sourceId)));
        s.groups=[...new Set([...s.groups,...s.sources.flatMap(sourceGroups)])];
        s.tags=[...new Set([...s.tags,...s.sources.flatMap(x=>x.tags),...incoming.flatMap(x=>x.tags)])];
      });
      this.articlesChanged?.([...new Set(incoming.map(a=>a.id))].map(id=>this.repo.state.articles.find(a=>a.id===id)!).filter(Boolean));
      return usable.length;
    });
  }
  refresh(sourceIds?:string[]):Promise<{failed:number;total:number;skipped:number}>{
    const ids=[...new Set(sourceIds??this.repo.state.sources.filter(s=>!s.paused).map(s=>s.id))].sort(),key=JSON.stringify(ids);
    const pending=this.refreshing.get(key);if(pending)return pending;
    this.refreshScopes.set(key,ids);this.emitRefresh();const job=this.runRefresh(ids).finally(()=>{this.refreshing.delete(key);this.refreshScopes.delete(key);this.emitRefresh();});this.refreshing.set(key,job);return job;
  }
  private async refreshSlot<T>(work:()=>Promise<T>):Promise<T>{
    // Different clicked ranges share the existing three-request budget.
    if(this.activeRefreshes<3)this.activeRefreshes++;else await new Promise<void>(resolve=>this.refreshWaiters.push(resolve));
    try{return await work();}finally{const next=this.refreshWaiters.shift();if(next)next();else this.activeRefreshes--;}
  }
  private async runRefresh(sourceIds?:string[]):Promise<{failed:number;total:number;skipped:number}>{
    await this.repo.load();
    const sources=this.repo.state.sources.filter(s=>!s.paused&&(!sourceIds||sourceIds.includes(s.id)));let failed=0,skipped=0,cursor=0;
    await Promise.all(Array.from({length:Math.min(3,sources.length)},async()=>{
      while(cursor<sources.length&&!this.closed){
        const source=sources[cursor++];
        let task=this.sourceRefreshes.get(source.id);
        if(!task){task=this.refreshSlot(async()=>{
          if(this.closed||(source.retryAfter??0)>Date.now())return 'skipped' as const;
          try{
          const started=performance.now();this.trace?.({event:'feedDiscoveryStart',url:source.url,t:started,at:Date.now()});
          if(source.api){const result=await this.apiSources.listing(source);await this.commit([{source:{...source,fetchedAt:Date.now(),api:{...source.api,cursor:result.cursor}},items:result.items}]);return 'ok' as const;}
          const response=await this.remote.get(source.url,{...(source.etag?{'If-None-Match':source.etag}:{}),...(source.modified?{'If-Modified-Since':source.modified}:{})});
          if(response.status===304){
            await this.repo.update(s=>{const live=s.sources.find(x=>x.id===source.id);if(live)Object.assign(live,{fetchedAt:Date.now(),error:undefined,failures:0,retryAfter:undefined});});
          }else{
            const parsed=await this.registry.get(source.type).discover(response,source);
            this.trace?.({event:'feedDiscoveryEnd',url:source.url,t:performance.now(),at:Date.now(),ms:performance.now()-started,covers:parsed.items.filter(i=>i.article.cover).length});
            await this.commit([{source:{...source,fetchedAt:Date.now(),etag:header(response,'etag'),modified:header(response,'last-modified')},items:parsed.items}]);
          }
          return 'ok' as const;
        }catch(error){
          if(!this.closed)await this.repo.update(s=>{const live=s.sources.find(x=>x.id===source.id);if(live){
            live.failures=(live.failures??0)+1;live.retryAfter=Date.now()+retryDelay(live.failures);live.error=(error as Error).message;
          }});
          return 'failed' as const;
        }
        }).finally(()=>this.sourceRefreshes.delete(source.id));this.sourceRefreshes.set(source.id,task);}
        const result=await task;if(result==='failed')failed++;else if(result==='skipped')skipped++;
      }
    }));
    if(!this.closed)await this.prune();
    return{failed,total:sources.length,skipped};
  }
  async prune():Promise<void>{
    const deadline=Date.now()-this.repo.state.settings.retentionDays*86400_000;
    const ids:string[]=[];
    await withWorkspaceLock('ingestion',async()=>{
      await this.repo.update(s=>{const stopped=new Set(s.sources.filter(source=>source.paused).map(source=>source.id));s.articles=s.articles.filter((a,index)=>{
        const remove=!a.later&&!a.importedId&&!s.imports[a.id]&&!(a.sourceIds??[a.sourceId]).some(id=>stopped.has(id))&&((a.published>0&&a.published<deadline)||index>=10000);
        if(remove)ids.push(a.id);return !remove;
      });});
      for(const id of ids)await this.repo.removeBody(id);
    });
  }
  read(article:Article):Promise<ArticleBody>{
    const pending=this.reads.get(article.id);if(pending)return pending;
    const job=this.loadArticle(article).finally(()=>this.reads.delete(article.id));this.reads.set(article.id,job);return job;
  }
  preview(article:Article,renew=false):Promise<string|undefined>{
    const live=this.repo.state.articles.find(a=>a.id===article.id)??article;
    if(live.api)return Promise.resolve(live.cover);
    if(live.previewCover&&!renew)return Promise.resolve(live.previewCover);
    if(!live.url||this.closed||((!renew||live.coverFetch?.state==='failed')&&(live.coverFetch?.retryAfter??0)>Date.now())||(renew&&Date.now()-(live.coverFetch?.checkedAt??0)<30_000))return Promise.resolve(undefined);
    const old=this.previews.get(live.id);if(old)return old;
    // Two independent metadata lanes; full-text work does not occupy either lane.
    const lane=this.previewCursor++%2;
    const wait=this.previewQueue[lane]??Promise.resolve();
    const job=wait.then(async()=>{
      if(this.closed)return;
      const start=performance.now();this.trace?.({event:'coverDiscoveryStart',url:live.url,t:start,at:Date.now()});
      try{
        const response=await this.remote.get(live.url),cover=pageCover(response.body,live.url);
        // A fast alternate is accepted only when it wraps the exact feed image; never swap unrelated pictures.
        const chosen=cover&&(!live.cover||sameImage(live.cover,cover))?cover:undefined;
        await this.repo.update(s=>{const a=s.articles.find(a=>a.id===live.id);if(a){
          if(chosen){a.previewCover=chosen;if(!a.cover){a.cover=chosen;a.coverOrigin='page';}}
          a.coverFetch={state:chosen?'available':'failed',attempts:(a.coverFetch?.attempts??0)+1,checkedAt:Date.now(),retryAfter:Date.now()+(chosen?30*86400_000:6*3600_000)};
        }});
        this.trace?.({event:'coverDiscoveryEnd',url:live.url,cover:chosen,t:performance.now(),ms:performance.now()-start,at:Date.now()});return chosen;
      }catch(error){
        if(!this.closed)await this.repo.update(s=>{const a=s.articles.find(a=>a.id===live.id);if(a){const attempts=(a.coverFetch?.attempts??0)+1;a.coverFetch={state:'failed',attempts,checkedAt:Date.now(),retryAfter:Date.now()+retryDelay(attempts),error:String(error)};}});
        this.trace?.({event:'coverDiscoveryError',url:live.url,error:String(error),t:performance.now(),at:Date.now()});return undefined;
      }
    }).finally(()=>this.previews.delete(live.id));
    this.previewQueue[lane]=job.then(()=>{});this.previews.set(live.id,job);return job;
  }
  private async loadArticle(input:Article):Promise<ArticleBody>{
    await this.repo.load();const article=this.repo.state.articles.find(a=>a.id===input.id)??input;
    let body=await this.repo.body(article.id)??{html:safeHtml(article.summary,article.url),kind:'summary' as const};
    if(article.later)body=betterBody(body,await this.repo.savedBody(article.id)??body);
    if(article.api){try{return await this.apiSources.body(article,body);}catch{return body;}}
    if(body.checkedPage||!article.url||(article.contentFetch?.retryAfter??0)>Date.now())return body;
    let page:ReturnType<typeof extractPage>;
    try{
      page=extractPage((await this.remote.get(article.url)).body,article.url);
      if(body.kind==='summary'&&!page.html)throw Error('原文页面未提供可提取正文。');
    }catch(error){
      if(this.closed)throw error;
      await this.repo.update(s=>{const a=s.articles.find(x=>x.id===article.id);if(a){
        const attempts=(a.contentFetch?.attempts??0)+1;
        a.contentFetch={state:body.kind==='summary'?'failed':'available',attempts,checkedAt:Date.now(),retryAfter:Date.now()+retryDelay(attempts),error:(error as Error).message};
      }});
      return body;
    }
    return withWorkspaceLock('ingestion',async()=>{
      const latest=await this.repo.body(article.id);
      body=betterBody(latest??body,page.html?{html:page.html,kind:'extracted'}:body);
      body={...body,checkedPage:true};await this.repo.saveBody(article.id,body);
      const contentVersion=await digest(`${article.title}\n${body.kind}\n${body.html}`);
      await this.repo.update(s=>{const a=s.articles.find(x=>x.id===article.id);if(!a)return;
        a.contentKind=body.kind;a.contentFetch={state:'available',attempts:0,checkedAt:Date.now()};
        if(a.contentVersion!==contentVersion&&a.translation?.state==='ready')a.translation.state='stale';
        a.contentVersion=contentVersion;
        if(a.coverOrigin!=='feed'){a.cover=page.cover||firstBodyImage(body.html,article.url)||a.cover;a.coverOrigin=page.cover?'page':a.cover?'body':undefined;}
      });
      if(this.repo.state.articles.find(a=>a.id===article.id)?.later){
        const saved=betterBody(await this.repo.savedBody(article.id),body);
        await this.repo.saveSnapshot(article.id,saved);
        await this.repo.update(s=>{const a=s.articles.find(x=>x.id===article.id);if(a?.later)a.savedKind=saved.kind;});
      }
      return body;
    });
  }
  async toggleLater(id:string):Promise<void>{
    await withWorkspaceLock('ingestion',async()=>{
      await this.repo.load();const a=this.repo.state.articles.find(x=>x.id===id);if(!a)return;
      const later=!a.later;
      const body=later?await this.repo.body(id)??{html:safeHtml(a.summary,a.url),kind:'summary' as const}:undefined;
      if(body)await this.repo.saveSnapshot(id,body);
      await this.repo.update(s=>{const live=s.articles.find(x=>x.id===id);if(live){live.later=later;live.savedKind=body?.kind;}});
      if(!later)await this.repo.io.remove(`saved-${id}.json`);
    });
    const current=this.repo.state.articles.find(a=>a.id===id);if(current)this.laterChanged?.(current);
  }
  dispose():void{this.closed=true;this.refreshListeners.clear();this.refreshScopes.clear();}
}
