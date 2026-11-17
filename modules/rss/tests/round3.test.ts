import './environment';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Repository} from '../src/storage';
import {RssService} from '../src/service';
import {RemoteClient,type Kernel} from '../src/kernel';
import {Inbox} from '../src/inbox';
import {permanentCover} from '../src/assets';
import type {Article} from '../src/model';
import type {ImageCache} from '../src/cache';

function memory(){const files=new Map<string,unknown>();return new Repository({load:async k=>structuredClone(files.get(k)),save:async(k,v)=>{files.set(k,structuredClone(v));},remove:async k=>{files.delete(k);}});}
const article:Article={id:'round3',sourceId:'a',guid:'x',title:'文章主标题',url:'https://site.test/article',author:'作者',published:new Date(2026,9,6,0,30).getTime(),summary:'摘要',tags:['AI'],later:true,contentKind:'feed',cover:'https://site.test/image.jpg'};
const bridge={version:1 as const,register:()=>()=>{},open:()=>{},close:()=>{},rootInboxTargets:async()=>[{id:'root',name:'独立验收'}]};

test('same refresh range reuses task; a different or overlapping range refreshes only its own sources',async()=>{
  const repo=memory();await repo.load();await repo.update(s=>{s.sources=['a','b','c'].map(id=>({id,url:`https://site.test/${id}`,title:id,group:'组',tags:[]}));});
  const resolvers=new Map<string,()=>void>(),calls:string[]=[];
  const service=new RssService(repo,new RemoteClient(async<T>(_p:string,b:Record<string,unknown>)=>{const url=b.url as string;calls.push(url);await new Promise<void>(resolve=>resolvers.set(url,resolve));return{status:304,body:'',headers:{}} as T;}));
  const first=service.refresh(['b','a']);assert.equal(service.refresh(['a','b','a']),first);
  const second=service.refresh(['b','c']);
  while(calls.length<3)await new Promise(resolve=>setTimeout(resolve,1));
  assert.deepEqual([...calls].sort(),['https://site.test/a','https://site.test/b','https://site.test/c']);resolvers.forEach(resolve=>resolve());
  assert.deepEqual(await first,{total:2,failed:0,skipped:0});assert.deepEqual(await second,{total:2,failed:0,skipped:0});
  const third=service.refresh(['a']);while(calls.length<4)await new Promise(resolve=>setTimeout(resolve,1));resolvers.get('https://site.test/a')!();await third;assert.equal(calls.length,4);
});

test('Inbox cover failure never reports success; retry keeps the same document and persistent asset',async()=>{
  const repo=memory();await repo.load();await repo.update(s=>{s.sources=[{id:'a',url:'https://site.test/feed',title:'来源',group:'验收',tags:[]}];s.articles=[article];});
  let uploads=0,creates=0,failCover=true,failRename=true,markdown='',attrs:Record<string,string>={};
  const api:Kernel=async<T>(path:string,body:Record<string,unknown>)=>{
    if(path.endsWith('getIDsByHPath'))return [] as T;
    if(path.endsWith('createDocWithMd')){creates++;markdown=body.markdown as string;return 'doc' as T;}
    if(path.endsWith('setBlockAttrs'))attrs={...(attrs as object),...(body.attrs as object)} as Record<string,string>;
    if(path.endsWith('getPathByID'))return {notebook:'root',path:'/doc.sy'} as T;
    if(path.endsWith('renameDoc')&&failRename){failRename=false;throw Error('rename interrupted');}
    if(path.endsWith('getBlockAttrs'))return attrs as T;
    return null as T;
  };
  const service={read:async()=>({html:'<p>正文与<a href="https://site.test/link">链接</a></p><img src="https://site.test/body.png">',kind:'feed'})} as unknown as RssService;
  const inbox=new Inbox(repo,service,api,()=>bridge,async()=>{if(failCover){failCover=false;throw Error('cover timeout');}uploads++;return 'assets/permanent.jpg';});
  await assert.rejects(inbox.import(article),/cover timeout/);assert.equal(creates,0);assert.ok(!repo.state.imports.round3.completed);
  await assert.rejects(inbox.import(article),/rename interrupted/);assert.equal(repo.state.imports.round3.documentId,'doc');
  const ids=await Promise.all([inbox.import(article),inbox.import(article)]);assert.deepEqual(ids,['doc','doc']);assert.equal(creates,1);assert.equal(uploads,1);
  assert.equal(attrs['title-img'],'background-image: url("assets/permanent.jpg"); background-position: 50% 60%;');assert.ok(repo.state.imports.round3.completed);assert.equal(repo.state.articles[0].later,true);
  assert.ok(markdown.startsWith('> 原文：'));assert.doesNotMatch(markdown,/^# /m);assert.doesNotMatch(markdown,/内容：/);assert.match(markdown,/> 发布时间：2026年10月6日/);assert.match(markdown,/\[链接\]\(https:\/\/site.test\/link\)/);assert.match(markdown,/!\[\]\(https:\/\/site.test\/body.png\)/);
  const quote=markdown.split('\n\n')[0].split('\n');assert.ok(quote.every(line=>line.startsWith('>')));assert.equal(quote.filter(line=>line.startsWith('> ')).length,4);
});

test('rapid clicks across different source ranges preserve the global three-request budget',async()=>{
  const repo=memory();await repo.load();await repo.update(s=>{s.sources=Array.from({length:10},(_,i)=>({id:String(i),url:`https://site.test/${i}`,title:String(i),group:'组',tags:[]}));});
  let active=0,peak=0,calls=0;
  const service=new RssService(repo,new RemoteClient(async<T>()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;return {status:304,body:'',headers:{}} as T;}));
  await Promise.all(repo.state.sources.map(s=>service.refresh([s.id])));assert.equal(calls,10);assert.equal(peak,3);assert.equal(active,0);
});

test('persistent cover uses deterministic native assets and recovers a lost upload response without another write',async()=>{
  const original=globalThis.fetch,files=new Map<string,Blob>();let writes=0,failOnce=true;
  globalThis.fetch=(async(input,init)=>{
    if(input==='blob:cached')return new Response(new Blob(['validated bytes'],{type:'image/jpeg'}));
    if(input==='/api/file/getFile'){const path=JSON.parse(init!.body as string).path;return files.has(path)?new Response(files.get(path)):Response.json({code:404},{status:202});}
    if(input==='/api/file/putFile'){const form=init!.body as FormData;files.set(form.get('path') as string,form.get('file') as Blob);writes++;if(failOnce){failOnce=false;throw Error('lost response');}return Response.json({code:0});}
    throw Error(`unexpected ${input}`);
  }) as typeof fetch;
  try{
    const save=permanentCover({get:async()=> 'blob:cached'} as unknown as ImageCache,new AbortController().signal);
    await assert.rejects(save(article),/lost response/);const path=await save(article);assert.match(path,/^assets\/yzc-rss-[a-f0-9]{64}\.jpg$/);assert.equal(writes,1);assert.equal(files.size,1);
  }finally{globalThis.fetch=original;}
});
