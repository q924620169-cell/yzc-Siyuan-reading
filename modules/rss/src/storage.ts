import {initialState,readState,normalizeHistory,sourceGroups,setSourceGroups,type RssState,type ArticleBody} from './model';

export interface DataIO {
  load(name:string):Promise<unknown>;
  save(name:string,data:unknown):Promise<void>;
  remove(name:string):Promise<void>;
}
const localLocks=new Map<string,Promise<unknown>>();
export async function withWorkspaceLock<T>(name:string,run:()=>Promise<T>):Promise<T>{
  if(globalThis.navigator?.locks)return await navigator.locks.request(`yzc-RSS:${name}`,run);
  const job=(localLocks.get(name)??Promise.resolve()).catch(()=>{}).then(run);
  localLocks.set(name,job);
  try{return await job;}finally{if(localLocks.get(name)===job)localLocks.delete(name);}
}
/** Commit a complete snapshot before publishing it. A failed write never looks saved. */
export class Repository {
  private value=initialState();
  private queue:Promise<unknown>=Promise.resolve();
  private listeners=new Set<()=>void>();
  private closed=false;
  constructor(readonly io:DataIO){}
  get state():RssState{return this.value;}
  async load():Promise<void>{
    await this.queue;
    await withWorkspaceLock('state',async()=>{this.value=await this.readCompatible();});
  }
  async reload():Promise<void>{await this.load();if(!this.closed)this.listeners.forEach(cb=>cb());}
  private async readCompatible():Promise<RssState>{
    const raw=await this.io.load('state.json');
    const next=readState(raw);
    if((raw as {version?:number})?.version===1){
      if(!await this.io.load('state-v1-backup.json'))await this.io.save('state-v1-backup.json',raw);
      await this.io.save('state.json',next);
    }
    if((raw as RssState|undefined)?.version===2&&(raw as RssState).sources.some(s=>s.groups===undefined)){
      if(!await this.io.load('state-single-group-backup.json'))await this.io.save('state-single-group-backup.json',raw);
      await this.io.save('state.json',next);
    }
    return next;
  }
  subscribe(cb:()=>void):()=>void{this.listeners.add(cb);return()=>this.listeners.delete(cb);}
  update(edit:(s:RssState)=>void):Promise<void>{
    const job=this.queue.then(()=>withWorkspaceLock('state',async()=>{
      if(this.closed)throw new Error('RSS 已关闭。');
      const latest=await this.readCompatible();
      const next=structuredClone(latest);edit(next);
      next.sources.forEach(s=>setSourceGroups(s,sourceGroups(s)));
      next.history=normalizeHistory(next.history,next.articles);
      await this.io.save('state.json',next);
      this.value=next;this.listeners.forEach(cb=>cb());
    }));
    this.queue=job.catch(()=>{});return job;
  }
  async body(id:string):Promise<ArticleBody|undefined>{
    const data=await this.io.load(`body-${id}.json`) as ArticleBody|undefined;
    return data && typeof data.html==='string'?data:undefined;
  }
  recordOpened(id:string,openedAt=Date.now()):Promise<void>{return this.update(s=>{const a=s.articles.find(a=>a.id===id);if(!a)return;s.history=[{articleId:id,openedAt,sourceId:a.sourceId,title:a.title,url:a.url},...s.history.filter(h=>h.articleId!==id)];});}
  saveBody(id:string,body:ArticleBody):Promise<void>{return this.io.save(`body-${id}.json`,body);}
  async savedBody(id:string):Promise<ArticleBody|undefined>{return await this.io.load(`saved-${id}.json`) as ArticleBody|undefined;}
  saveSnapshot(id:string,body:ArticleBody):Promise<void>{return this.io.save(`saved-${id}.json`,body);}
  async removeBody(id:string):Promise<void>{await this.io.remove(`body-${id}.json`);await this.io.remove(`saved-${id}.json`);await this.io.remove(`translation-${id}.json`);}
  async settled():Promise<void>{await this.queue;}
  dispose():void{this.closed=true;this.listeners.clear();}
}
