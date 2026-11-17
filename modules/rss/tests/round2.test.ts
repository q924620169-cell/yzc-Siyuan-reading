import './environment';
import test from 'node:test';
import assert from 'node:assert/strict';
import {chineseDate,displayIdentity,initialState,mergeArticles,type Article} from '../src/model';
import {pageCover,sameImage} from '../src/content';
import {Repository} from '../src/storage';
import {ImageCache} from '../src/cache';
import {RemoteClient,type Kernel} from '../src/kernel';
import {RssService} from '../src/service';
const sample=():Article=>({id:'a',sourceId:'s',guid:'a',url:'https://site.test/a',title:'Title',author:'Writer',published:Date.now(),summary:'摘要',tags:[],later:false,contentKind:'summary'});
function memory(){const files=new Map<string,unknown>();return new Repository({load:async k=>structuredClone(files.get(k)),save:async(k,v)=>{files.set(k,structuredClone(v));},remove:async k=>{files.delete(k);}});}
test('local calendar dates, midnight, missing dates and deduplicated source display',()=>{
  const now=new Date(2026,9,20,0,3).getTime();
  assert.equal(chineseDate(new Date(2026,9,20,0,1).getTime(),now),'今天 00:01');
  assert.equal(chineseDate(new Date(2026,9,19,23,59).getTime(),now),'昨天 23:59');
  assert.equal(chineseDate(new Date(2026,9,18,9,15).getTime(),now),'前天 09:15');
  assert.equal(chineseDate(new Date(2026,8,3,8).getTime(),now),'2026年9月3日');
  assert.equal(chineseDate(NaN,now),'发布时间未知');assert.equal(chineseDate(0,now),'发布时间未知');
  assert.deepEqual(displayIdentity('Derek Sivers — Articles','Derek Sivers'),['Derek Sivers']);
  assert.deepEqual(displayIdentity('Dan Koe','DAN KOE'),['Dan Koe']);assert.deepEqual(displayIdentity('Aeon','Writer'),['Aeon','Writer']);
});
test('preview metadata is inert, exact-image alternate only and changing feed cover invalidates it',()=>{
  assert.equal(pageCover('<script>throw 1</script><meta property="og:image" content="/cover.jpg">','https://site.test/a'),'https://site.test/cover.jpg');
  assert.equal(sameImage('https://media.test/a.jpg','https://cdn.test/image/https%3A%2F%2Fmedia.test%2Fa.jpg'),true);
  assert.equal(sameImage('https://media.test/a.jpg','https://cdn.test/b.jpg'),false);
  assert.equal(sameImage('https://media.test/a.jpg','https://cdn.test/image/https%3A%2F%2Fmedia.test%2Fa.jpg.fake.jpg'),false);
  const old={...sample(),cover:'https://media.test/a.jpg',coverOrigin:'feed' as const,previewCover:'https://cdn.test/a.jpg'};
  assert.equal(mergeArticles([old],[{...sample(),cover:old.cover,coverOrigin:'feed'}])[0].previewCover,old.previewCover);
  assert.equal(mergeArticles([old],[{...sample(),cover:'https://media.test/b.jpg',coverOrigin:'feed'}])[0].previewCover,undefined);
});
test('preview requests coalesce and never fetch or downgrade article bodies; failure cooldown persists',async()=>{
  const repo=memory();await repo.load();const a=sample();await repo.update(s=>{s.articles=[a];});let requests=0;
  const remote=new RemoteClient(async<T>()=>{requests++;return {status:200,body:'<meta property="og:image" content="https://cdn.test/cover.jpg">',headers:{}} as T;});
  const service=new RssService(repo,remote);const [one,two]=await Promise.all([service.preview(a),service.preview(a)]);
  assert.equal(one,two);assert.equal(requests,1);assert.equal(repo.state.articles[0].contentKind,'summary');assert.equal(await repo.body('a'),undefined);
  await repo.update(s=>{s.articles=[{...sample(),id:'b'}];});
  const failing=new RssService(repo,new RemoteClient(async()=>{requests++;throw Error('offline');}));
  await failing.preview(repo.state.articles[0]);const n=requests;await failing.preview(repo.state.articles[0]);assert.equal(requests,n);
  assert.equal(repo.state.articles[0].coverFetch?.state,'failed');assert.deepEqual(repo.state.articles[0].contentFetch,{state:'pending',attempts:0});
});
test('image display is independent of slow writes; alternate lane, dedup, memory reuse and cooldown',async()=>{
  const repo=memory();await repo.load();const nativeFetch=globalThis.fetch,nativeBitmap=globalThis.createImageBitmap;
  let releaseWrite!:()=>void;const writeBlocked=new Promise<void>(r=>releaseWrite=r);let writes=0,downloads=0;
  const blockers=new Map<string,()=>void>();
  const api:Kernel=async<T>(_path:string,body:Record<string,unknown>)=>{downloads++;const url=String(body.url);if(url.includes('stalled'))await new Promise<void>(r=>blockers.set(url,r));if(url.includes('bad'))throw Error('offline');return {status:200,body:btoa('valid image fixture'),headers:{'content-type':['image/jpeg']}} as T;};
  globalThis.fetch=(async(url)=>{if(String(url).includes('putFile')){writes++;await writeBlocked;return new Response('{"code":0}');}return new Response('',{status:404});}) as typeof fetch;
  globalThis.createImageBitmap=(async()=>({width:300,height:200,close(){}})) as unknown as typeof createImageBitmap;
  const cache=new ImageCache(repo,new RemoteClient(api),api,new AbortController().signal);
  try{
    const slow1=cache.get('https://image.test/stalled1.jpg'),slow2=cache.get('https://image.test/stalled2.jpg');
    await new Promise(r=>setTimeout(r,10));
    const quick=cache.get('https://image.test/fast.jpg',true),duplicate=cache.get('https://image.test/fast.jpg',true);assert.equal(quick,duplicate);
    const src=await quick;assert.match(src!,/^blob:/);assert.equal(await cache.get('https://image.test/fast.jpg'),src);assert.equal(downloads,3);assert.equal(writes,1);assert.equal(Object.keys(repo.state.cache).length,0);
    releaseWrite();for(const release of blockers.values())release();await Promise.all([slow1,slow2]);await cache.settled();assert.equal(Object.keys(repo.state.cache).length,3);
    await cache.get('https://image.test/bad.jpg');const n=downloads;await cache.get('https://image.test/bad.jpg');assert.equal(downloads,n);
  }finally{releaseWrite();for(const release of blockers.values())release();cache.dispose();globalThis.fetch=nativeFetch;globalThis.createImageBitmap=nativeBitmap;}
});

test('expired preview URL can refresh declared metadata without changing original cover',async()=>{
  const repo=memory();await repo.load();const raw='https://media.test/a.jpg',replacement='https://cdn.test/image/'+encodeURIComponent(raw);
  await repo.update(s=>{s.articles=[{...sample(),cover:raw,coverOrigin:'feed',previewCover:'https://cdn.test/expired.jpg',coverFetch:{state:'available',attempts:1,checkedAt:Date.now()-60_000,retryAfter:Date.now()+86400_000}}];});
  let requests=0;const service=new RssService(repo,new RemoteClient(async<T>()=>{requests++;return{status:200,body:`<meta property="og:image" content="${replacement}">`,headers:{}} as T;}));
  assert.equal(await service.preview(repo.state.articles[0],true),replacement);assert.equal(repo.state.articles[0].cover,raw);
  await service.preview(repo.state.articles[0],true);assert.equal(requests,1);
});
test('a replaced slow original is cancelled without imposing a failure cooldown',async()=>{
  const repo=memory();await repo.load();const nativeFetch=globalThis.fetch,nativeBitmap=globalThis.createImageBitmap;let started!:()=>void;
  const ready=new Promise<void>(r=>started=r);let calls=0;
  const api:Kernel=async<T>(_path:string,_body:Record<string,unknown>,signal?:AbortSignal)=>{calls++;if(calls===1){started();await new Promise((_,reject)=>signal!.addEventListener('abort',()=>reject(signal!.reason),{once:true}));}return{status:200,body:btoa('fixture'),headers:{'content-type':['image/jpeg']}} as T;};
  globalThis.fetch=(async()=>new Response('{"code":0}')) as typeof fetch;globalThis.createImageBitmap=(async()=>({width:300,height:200,close(){}})) as unknown as typeof createImageBitmap;
  const cache=new ImageCache(repo,new RemoteClient(api),api,new AbortController().signal),url='https://image.test/slow.jpg';
  try{const pending=cache.get(url);await ready;cache.cancel(url);assert.equal(await pending,undefined);assert.match((await cache.get(url))!,/^blob:/);assert.equal(calls,2);await cache.flush();}
  finally{cache.dispose();globalThis.fetch=nativeFetch;globalThis.createImageBitmap=nativeBitmap;}
});
