import type {Repository} from './storage';
import {digest,type CacheEntry} from './model';
import {header,removeFile,type Kernel,type RemoteClient} from './kernel';

export function evictions(entries:Record<string,CacheEntry>,limit:number,now=Date.now()):string[]{
  let bytes=Object.values(entries).reduce((sum,x)=>sum+x.bytes,0);const out:string[]=[];
  for(const [key,item] of Object.entries(entries).sort((a,b)=>a[1].used-b[1].used))if(bytes>limit||now-item.used>30*86400_000){out.push(key);bytes-=item.bytes;}
  return out;
}
const ROOT='/data/storage/petal/yzc-INL/rss/images/';
interface Job {fallback:boolean;run:()=>void}
export class ImageCache {
  private queue:Promise<unknown>=Promise.resolve();
  private objects=new Map<string,{src:string;bytes:number;key:string}>();
  private pending=new Map<string,Promise<string|undefined>>();
  private requests=new Map<string,AbortController>();
  private failures=new Map<string,{until:number;attempts:number}>();
  private jobs:Job[]=[];
  private active=0;private normalActive=0;private closed=false;private generation=0;
  private queuedBytes=0;private queuedWrites=0;
  private touches=new Set<string>();
  trace?:(event:Record<string,unknown>)=>void;
  constructor(private repo:Repository,private remote:RemoteClient,private api:Kernel,private signal:AbortSignal){}
  private log(event:string,data:Record<string,unknown>={}):void{this.trace?.({event,t:performance.now(),at:Date.now(),...data});}
  private serial<T>(run:()=>Promise<T>):Promise<T>{const p=this.queue.then(run);this.queue=p.catch(()=>{});return p;}
  private network<T>(run:()=>Promise<T>,fallback:boolean):Promise<T>{
    return new Promise((resolve,reject)=>{this.jobs.push({fallback,run:()=>{
      this.active++;if(!fallback)this.normalActive++;
      void run().then(resolve,reject).finally(()=>{this.active--;if(!fallback)this.normalActive--;this.drain();});
    }});this.drain();});
  }
  private drain():void{
    while(this.active<3){
      // Reserve one slot for a visible image's declared alternate, so stalled originals cannot block it.
      let i=this.jobs.findIndex(j=>j.fallback);if(i<0&&this.normalActive<2)i=this.jobs.findIndex(j=>!j.fallback);
      if(i<0)return;this.jobs.splice(i,1)[0].run();
    }
  }
  get(url:string,fallback=false):Promise<string|undefined>{
    if(this.closed)return Promise.resolve(undefined);
    const object=this.objects.get(url);
    if(object){this.objects.delete(url);this.objects.set(url,object);this.log('memoryHit',{url});this.touch(object.key);this.trimObjects(url);return Promise.resolve(object.src);}
    const active=this.pending.get(url);if(active){this.log('pendingHit',{url});return active;}
    if((this.failures.get(url)?.until??0)>Date.now()){this.log('cooldown',{url});return Promise.resolve(undefined);}
    const controller=new AbortController();this.requests.set(url,controller);
    const job=this.fetchImage(url,fallback,controller.signal).catch(error=>{
      if(controller.signal.aborted){this.log('cancelled',{url});return undefined;}
      const attempts=(this.failures.get(url)?.attempts??0)+1;
      this.failures.set(url,{attempts,until:Date.now()+Math.min(300_000,30_000*2**Math.min(attempts-1,4))});
      if(this.failures.size>256)this.failures.delete(this.failures.keys().next().value!);
      this.log('imageError',{url,error:String(error)});return undefined;
    }).finally(()=>{this.pending.delete(url);if(this.requests.get(url)===controller)this.requests.delete(url);});
    this.pending.set(url,job);return job;
  }
  private ready(url:string,key:string,blob:Blob):string|undefined{
    if(this.closed)return;
    const src=URL.createObjectURL(blob);this.objects.set(url,{src,bytes:blob.size,key});this.failures.delete(url);
    this.log('ready',{url,bytes:blob.size});this.trimObjects(url);return src;
  }
  private touch(key:string):void{
    const existing=this.repo.state.cache[key];if(!existing||Date.now()-existing.used<60_000||this.touches.has(key))return;
    this.touches.add(key);void this.serial(()=>this.repo.update(s=>{if(s.cache[key])s.cache[key].used=Date.now();})).catch(()=>{}).finally(()=>this.touches.delete(key));
  }
  private trimObjects(protect?:string):void{
    let bytes=[...this.objects.values()].reduce((n,x)=>n+x.bytes,0);
    const displayed=new Set([...document.querySelectorAll<HTMLImageElement>('.rss-tab img')].map(e=>e.src));
    for(const [url,item] of this.objects){
      if(this.objects.size<=128&&bytes<=64*1024*1024)break;
      if(url===protect||displayed.has(item.src))continue;
      URL.revokeObjectURL(item.src);this.objects.delete(url);bytes-=item.bytes;
    }
  }
  cancel(url:string):void{this.requests.get(url)?.abort();}
  private async fetchImage(url:string,fallback:boolean,requestSignal:AbortSignal):Promise<string|undefined>{
    const generation=this.generation,key=await digest(url),existing=this.repo.state.cache[key];
    if(existing){
      try{
        const start=performance.now();
        const response=await fetch('/api/file/getFile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:existing.path}),signal:this.signal});
        if(response.ok&&response.headers.get('content-type')?.startsWith('image/')){
          const blob=await response.blob();const bitmap=await createImageBitmap(blob);bitmap.close();this.log('diskHit',{url,ms:performance.now()-start});
          const src=this.ready(url,key,blob);
          if(Date.now()-existing.used>60_000)void this.serial(()=>this.repo.update(s=>{if(s.cache[key])s.cache[key].used=Date.now();})).catch(()=>{});
          return src;
        }
      }catch(error){if(this.signal.aborted)throw error;}
      this.log('diskMissing',{url});
      void this.serial(()=>this.repo.update(s=>{delete s.cache[key];})).catch(()=>{});
    }
    const limit=this.repo.state.settings.cacheMB*1024*1024;if(!limit)return url;
    const response=await this.network(async()=>{
      requestSignal.throwIfAborted();if(this.closed)throw Error('RSS 已关闭');
      const start=performance.now();this.log('networkStart',{url});
      const r=await this.remote.get(url,{},true,requestSignal);this.log('networkEnd',{url,ms:performance.now()-start,status:r.status,finalUrl:r.url});return r;
    },fallback);
    const mime=header(response,'content-type')?.split(';')[0]?.toLowerCase()??'';
    const extension:Record<string,string>={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif'};
    if(!extension[mime])throw Error('图片类型不受支持');
    const bytes=Uint8Array.from(atob(response.body),c=>c.charCodeAt(0));
    if(bytes.byteLength>8*1024*1024||bytes.byteLength>limit)throw Error('图片超过缓存容量');
    const blob=new Blob([bytes],{type:mime}),start=performance.now();this.log('decodeStart',{url});
    const bitmap=await createImageBitmap(blob);
    const accepted=bitmap.width>=120&&bitmap.height>=70&&bitmap.width/bitmap.height<=4&&bitmap.height/bitmap.width<=4;
    bitmap.close();this.log('decodeEnd',{url,ms:performance.now()-start});if(!accepted)throw Error('图片尺寸不合适');
    const src=this.ready(url,key,blob);
    // Display does not wait for file IO, index serialization or eviction. Buffers remain bounded.
    if(generation===this.generation&&this.queuedBytes+blob.size<=32*1024*1024&&this.queuedWrites<16){
      this.queuedBytes+=blob.size;this.queuedWrites++;
      void this.serial(async()=>{
        if(this.closed||generation!==this.generation)return;
        const began=performance.now(),path=`${ROOT}${key}.${extension[mime]}`;
        const form=new FormData();form.append('path',path);form.append('file',blob,`${key}.${extension[mime]}`);
        const saved=await fetch('/api/file/putFile',{method:'POST',body:form,signal:this.signal}).then(r=>r.json());
        if(saved.code!==0)throw Error(saved.msg||'图片缓存写入失败');
        await this.repo.update(s=>{s.cache[key]={path,bytes:blob.size,url,used:Date.now()};});
        this.log('writeEnd',{url,ms:performance.now()-began});
        if(this.queuedWrites===1)await this.trimNow();
      }).catch(error=>this.log('writeError',{url,error:String(error)})).finally(()=>{this.queuedBytes-=blob.size;this.queuedWrites--;});
    }
    return src;
  }
  async settled():Promise<void>{await Promise.all([...this.pending.values()]);await this.queue;}
  async flush():Promise<void>{await this.queue;}
  trim():Promise<void>{return this.serial(()=>this.trimNow());}
  private async trimNow(all=false):Promise<void>{
    const keys=all?Object.keys(this.repo.state.cache):evictions(this.repo.state.cache,this.repo.state.settings.cacheMB*1024*1024);
    for(const key of keys){
      const item=this.repo.state.cache[key];if(!item)continue;
      if(!item.path.startsWith(ROOT)||item.path.includes('..'))throw Error('缓存路径无效，未删除文件。');
      await removeFile(this.api,item.path);await this.repo.update(s=>{delete s.cache[key];});
    }
    // Active <img> elements keep their Blob URL until the view releases them or unload.
    this.trimObjects();
  }
  clear():Promise<void>{this.generation++;this.failures.clear();return this.serial(()=>this.trimNow(true));}
  dispose():void{this.closed=true;this.generation++;this.requests.forEach(c=>c.abort());this.objects.forEach(x=>URL.revokeObjectURL(x.src));this.objects.clear();this.drain();}
}
