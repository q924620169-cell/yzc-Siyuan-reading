import './environment';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Repository,type DataIO} from '../src/storage';
import {initialState,canonicalUrl,filterArticles,allFilter,type Article} from '../src/model';
import {RemoteClient,removeFile,type Kernel} from '../src/kernel';
import {RssService,betterBody,retryDelay} from '../src/service';
import {parseFeed} from '../src/feed';
import {SourceRegistry} from '../src/sources';

function memory(){
  const files=new Map<string,unknown>();const reads:string[]=[];
  const io:DataIO={load:async k=>{reads.push(k);return structuredClone(files.get(k));},save:async(k,v)=>{files.set(k,structuredClone(v));},remove:async k=>{files.delete(k);}};
  return{files,reads,io,repo:new Repository(io)};
}
const feed=(url='https://site.test/post',guid='stable',full=true,title='文章')=>`<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>来源</title><item><title>${title}</title>${url?`<link>${url.replaceAll('&','&amp;')}</link>`:''}${guid?`<guid>${guid}</guid>`:''}<pubDate>${new Date().toUTCString()}</pubDate><description>摘要</description>${full?`<content:encoded><![CDATA[<p>${'正文内容。'.repeat(80)}</p>]]></content:encoded>`:''}</item></channel></rss>`;
function client(handler:(url:string,request:Record<string,unknown>)=>{body:string;status?:number;headers?:Record<string,string[]>}|Promise<{body:string;status?:number;headers?:Record<string,string[]>}>){
  const calls:string[]=[];
  const api:Kernel=async<T>(_path:string,request:Record<string,unknown>)=>{
    calls.push(String(request.url));const r=await handler(String(request.url),request);
    return{status:200,headers:{},...r} as T;
  };return{remote:new RemoteClient(api),calls};
}
test('v1 migration preserves IDs, state, imports and body files and saves original backup exactly once',async()=>{
  const m=memory(),parsed=await parseFeed(feed(),'https://site.test/rss','s');
  const a={...parsed.items[0].article,later:true,importedId:'doc'};
  const old={...initialState(),version:1,sources:[{id:'s',url:'https://site.test/rss',title:'自定义',group:'收藏组',tags:['tag']}],articles:[a],imports:{[a.id]:{notebook:'root',path:'/article',documentId:'doc',completed:true}}};
  m.files.set('state.json',old);m.files.set(`body-${a.id}.json`,parsed.items[0].body);
  await m.repo.load();assert.equal(m.repo.state.version,2);assert.equal(m.repo.state.articles[0].id,a.id);
  assert.deepEqual(m.files.get('state-v1-backup.json'),old);assert.equal(m.repo.state.articles[0].later,true);
  assert.equal(m.repo.state.imports[a.id].documentId,'doc');assert.equal((await m.repo.body(a.id))!.kind,'feed');
  await m.repo.update(s=>s.tags.push('next'));await m.repo.load();assert.deepEqual(m.files.get('state-v1-backup.json'),old);
});
test('migration failure leaves original index intact; read failures never become empty state',async()=>{
  const m=memory(),old={...initialState(),version:1};m.files.set('state.json',old);
  const bad=new Repository({...m.io,save:async()=>{throw Error('disk full');}});
  await assert.rejects(bad.load(),/disk full/);assert.deepEqual(m.files.get('state.json'),old);
  await assert.rejects(new Repository({...m.io,load:async()=>{throw Error('offline');}}).load(),/offline/);
});
test('same article across two sources is one reader record and preserves full content and saved/imported state',async()=>{
  const m=memory();await m.repo.load();const c=client(url=>({body:feed('https://site.test/post','same',url.endsWith('/a'))}));
  const service=new RssService(m.repo,c.remote);await service.add('https://site.test/a','custom','group',[]);
  const id=m.repo.state.articles[0].id;await service.toggleLater(id);
  await m.repo.update(s=>{s.articles[0].importedId='doc';s.imports[id]={notebook:'root',path:'/x',documentId:'doc',completed:true};});
  await service.add('https://site.test/b','second','other',[]);
  assert.equal(m.repo.state.articles.length,1);const a=m.repo.state.articles[0];
  assert.equal(a.id,id);assert.equal(a.later,true);assert.equal(a.importedId,'doc');assert.equal(a.records?.length,2);
  assert.equal((await m.repo.body(id))?.kind,'feed');assert.match((await m.repo.body(id))!.html,/正文/);
  assert.equal(filterArticles(m.repo.state,{...allFilter(),mode:'source',value:m.repo.state.sources[1].id}).length,1);
});
test('same GUID changed URL keeps stable ID; known tracking removed but business params retained',async()=>{
  const m=memory();await m.repo.load();let body=feed();const c=client(()=>({body}));const service=new RssService(m.repo,c.remote);
  await service.add('https://site.test/feed','','g',[]);const id=m.repo.state.articles[0].id;
  body=feed('https://site.test/new?utm_source=x&id=20','stable',false);await service.refresh();
  assert.equal(m.repo.state.articles.length,1);assert.equal(m.repo.state.articles[0].id,id);assert.equal(m.repo.state.articles[0].canonicalUrl,'https://site.test/new?id=20');
  assert.equal((await m.repo.body(id))?.kind,'feed');
  body=feed('https://site.test/post','other-source-guid',false);await service.add('https://site.test/another','','g',[]);
  assert.equal(m.repo.state.articles.length,1);assert.equal(m.repo.state.articles[0].id,id);
  assert.notEqual(canonicalUrl('https://a.test/?id=1&ref=foo'),canonicalUrl('https://a.test/?id=2&ref=foo'));
});
test('fingerprint fallback never merges same title with distinct exact content',async()=>{
  const first=(await parseFeed(feed('','',false,'同标题'),'https://site.test/f','s')).items[0].article;
  const second=(await parseFeed(feed('','',false,'同标题').replace('摘要','不同摘要'),'https://site.test/f','s')).items[0].article;
  assert.notEqual(first.id,second.id);
});
test('conditional 304 avoids parsing and body writes; failure backoff survives reload and recovers',async()=>{
  const m=memory();await m.repo.load();let mode='initial';let headerSeen=false;
  const c=client((_url,r)=>{
    if(mode==='fail')throw Error('offline');
    if(mode==='304'){headerSeen=JSON.stringify(r.headers).includes('token-v1');return{body:'',status:304};}
    return{body:feed(),headers:{ETag:['token-v1'],'Last-Modified':['Tue, 20 Oct 2026 01:00:00 GMT']}};
  });
  const s=new RssService(m.repo,c.remote);await s.add('https://site.test/feed','','g',[]);
  const before=structuredClone(m.files.get(`body-${m.repo.state.articles[0].id}.json`));
  mode='304';await Promise.all([s.refresh(),s.refresh()]);assert.equal(c.calls.length,2);assert.equal(headerSeen,true);assert.deepEqual(m.files.get(`body-${m.repo.state.articles[0].id}.json`),before);
  mode='fail';assert.equal((await s.refresh()).failed,1);const count=c.calls.length;
  const reload=new Repository(m.io);await reload.load();assert.equal((await new RssService(reload,c.remote).refresh()).skipped,1);assert.equal(c.calls.length,count);
  await reload.update(state=>{state.sources[0].retryAfter=0;});mode='initial';
  assert.equal((await new RssService(reload,c.remote).refresh()).failed,0);assert.equal(reload.state.sources[0].error,undefined);
});
test('fulltext failure stays readable, cools down independently of feed refresh, and later recovers',async()=>{
  const m=memory();await m.repo.load();let fails=true;
  const c=client(url=>{if(url.endsWith('/feed'))return{body:feed(undefined,undefined,false)};if(fails)throw Error('timeout');
    return{body:`<html><body><article><h1>完整文章</h1><p>${'这是一篇可以阅读的完整正文。'.repeat(80)}</p></article></body></html>`};});
  const s=new RssService(m.repo,c.remote);await s.add('https://site.test/feed','','g',[]);const a=m.repo.state.articles[0];
  assert.equal((await s.read(a)).kind,'summary');assert.equal(m.repo.state.articles[0].contentFetch?.state,'failed');
  const count=c.calls.length;await s.read(a);assert.equal(c.calls.length,count);await s.refresh();assert.equal(m.repo.state.articles[0].contentFetch?.state,'failed');
  await m.repo.update(state=>{state.articles[0].contentFetch!.retryAfter=0;});fails=false;assert.equal((await s.read(a)).kind,'extracted');
  assert.equal(m.repo.state.articles[0].contentFetch?.state,'available');assert.ok(retryDelay(100)<=6*3600_000);
});
test('later snapshot retains full body after ordinary body loss and prune; summary is never labeled full',async()=>{
  const m=memory();await m.repo.load();const c=client(()=>({body:feed()}));const s=new RssService(m.repo,c.remote);
  await s.add('https://site.test/feed','','g',[]);const id=m.repo.state.articles[0].id;
  await s.toggleLater(id);m.files.delete(`body-${id}.json`);
  await m.repo.update(state=>{state.articles[0].published=1;state.articles[0].contentFetch={state:'available',attempts:1,retryAfter:Date.now()+60000};});
  await s.prune();assert.equal(m.repo.state.articles.length,1);assert.equal((await s.read(m.repo.state.articles[0])).kind,'feed');
  const empty:Article={...m.repo.state.articles[0],id:'summary',later:false,contentKind:'summary',summary:'只有摘要'};
  await m.repo.update(state=>state.articles.push(empty));await s.toggleLater(empty.id);assert.equal(m.repo.state.articles.find(a=>a.id===empty.id)?.savedKind,'summary');
});
test('optional translation is invalidated by changed original and never blocks source ingestion',async()=>{
  const m=memory();await m.repo.load();let body=feed();const c=client(()=>({body}));const s=new RssService(m.repo,c.remote);
  await s.add('https://site.test/feed','','g',[]);await m.repo.update(state=>{state.articles[0].translation={state:'ready',sourceVersion:state.articles[0].contentVersion,title:'译文'};});
  body=feed(undefined,undefined,true,'更新标题');await s.refresh();assert.equal(m.repo.state.articles[0].translation?.state,'stale');assert.equal(m.repo.state.articles[0].translation?.title,'译文');
  assert.equal(betterBody({html:'<p>完整文字内容</p>',kind:'feed'},{html:'短',kind:'summary'}).kind,'feed');
});
test('website declared feeds are validated and chosen; preview and cancellation never write; OPML skips existing',async()=>{
  const m=memory();await m.repo.load();
  const c=client(url=>({body:url.endsWith('/home')?'<html><head><link rel="alternate" type="application/rss+xml" href="/a" title="A"><link rel="alternate" type="application/atom+xml" href="/b" title="B"><link rel="alternate" type="application/rss+xml" href="/broken"></head></html>':url.endsWith('/broken')?'invalid':feed()}));
  const s=new RssService(m.repo,c.remote);const plan=await s.prepare('https://site.test/home');
  assert.equal(plan.kind,'choose');assert.equal(plan.candidates.length,2);assert.equal(m.files.size,0);
  await s.add(plan.candidates[0].url,'保留名称','保留分组',[]);
  const preview=await s.prepare('<opml><body><outline text="新组"><outline text="覆盖名称" xmlUrl="https://site.test/a"/><outline text="B" xmlUrl="https://site.test/b"/></outline></body></opml>');
  assert.equal(preview.candidates[0].existing,true);assert.equal(m.repo.state.sources.length,1);
  const result=await s.importCandidates(preview.candidates);assert.equal(result.added,1);assert.equal(m.repo.state.sources[0].title,'保留名称');assert.equal(m.repo.state.sources[0].group,'保留分组');
  assert.equal(m.repo.state.sources[1].group,'新组');
});
test('adapter registry exposes a small extension contract and rejects unknown platforms',()=>{
  const registry=new SourceRegistry([{type:'future',discover:async()=>({title:'x',items:[]})}]);
  assert.equal(registry.get('future').type,'future');assert.throws(()=>registry.get('unknown'),/不支持/);
});
test('cleanup tolerates an already absent body/snapshot, but never hides permission or transport failures',async()=>{
  await removeFile(async()=>{throw Error('path does not exist');},'/data/storage/petal/yzc-RSS/saved-x.json');
  await assert.rejects(removeFile(async()=>{throw Error('permission denied');},'/data/storage/petal/yzc-RSS/body-x.json'),/permission/);
});
