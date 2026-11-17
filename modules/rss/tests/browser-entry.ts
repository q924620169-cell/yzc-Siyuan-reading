import {Repository} from '../src/storage';
import {RssService} from '../src/service';
import {RemoteClient} from '../src/kernel';
import {RssView} from '../src/ui/view';
import type {ImageCache} from '../src/cache';
import type {Inbox} from '../src/inbox';

const files=new Map<string,unknown>();
const repo=new Repository({load:async k=>structuredClone(files.get(k)),save:async(k,v)=>{files.set(k,structuredClone(v));},remove:async k=>{files.delete(k);}});
await repo.load();
const service=new RssService(repo,new RemoteClient(async<T>(_path:string,request:Record<string,unknown>)=>{
  const r=await fetch(request.url as string);
  return {body:await r.text(),status:r.status,headers:Object.fromEntries([...r.headers].map(([k,v])=>[k,[v]]))} as T;
}));
const messages:string[]=[];
const view=new RssView({repo,service,cache:{get:async(url:string)=>url,trim:async()=>{},clear:async()=>{}} as unknown as ImageCache,
  inbox:{import:async()=>{throw Error('Fixture: no real document write');}} as unknown as Inbox,
  bridge:()=>undefined,message:text=>{messages.push(text);document.querySelector('#messages')!.textContent=text;},reschedule:()=>{}});
Object.assign(window,{siyuan:{config:{editor:{fullWidth:false}}},fixture:{repo,view,service,messages}});
document.querySelector('#sidebar')!.append(view.sidebar);view.attach(document.querySelector('#reader')!);
