import './environment';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFeed,parseOpml} from '../src/feed';
import {safeHtml,imageCandidate,extractPage} from '../src/content';
import {initialState,filterArticles,allFilter,groupSelection,mergeArticles,canonicalUrl,type Article} from '../src/model';
import {evictions} from '../src/cache';
import {Repository,type DataIO} from '../src/storage';
import {Inbox} from '../src/inbox';
import type {Kernel} from '../src/kernel';
import type {RssService} from '../src/service';

const article=(id:string,sourceId='a',tags:string[]=[]):Article=>({id,sourceId,tags,guid:id,url:`https://news.test/${id}`,title:id,author:'作者',published:123,summary:'摘要',later:false,contentKind:'summary'});
function memory(){
  const files=new Map<string,unknown>();let fail=false;
  const io:DataIO={load:async name=>structuredClone(files.get(name)),save:async(name,value)=>{if(fail)throw Error('disk full');files.set(name,structuredClone(value));},remove:async key=>{files.delete(key);}};
  return {io,files,fail:()=>{fail=true;}};
}
test('RSS parses CDATA, namespaces, Chinese titles, image priority and stable dedup identity',async()=>{
  const feed=`<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>真实来源</title><item><guid>001</guid><link>https://news.test/a?utm_source=feed</link><title>很长的中文标题</title><description><![CDATA[<p>摘要</p>]]></description><content:encoded><![CDATA[<p>正文</p><img src="/body.jpg"/>]]></content:encoded><media:content url="https://news.test/cover.jpg" type="image/jpeg" width="800" height="400"/><pubDate>Tue, 20 Oct 2026 09:00:00 GMT</pubDate><category>AI</category></item></channel></rss>`;
  const parsed=await parseFeed(feed,'https://news.test/feed','a'),a=parsed.items[0].article;
  assert.equal(parsed.title,'真实来源');assert.equal(a.cover,'https://news.test/cover.jpg');assert.equal(a.coverOrigin,'feed');
  assert.equal(a.url,'https://news.test/a');assert.equal(a.contentKind,'feed');assert.equal(a.tags[0],'AI');
  assert.match(parsed.items[0].body.html,/正文/);
  assert.equal((await parseFeed(feed,'https://news.test/feed','a')).items[0].article.id,a.id);
});
test('Atom XHTML, relative links and empty summaries; invalid XML, HTML and entities rejected',async()=>{
  const feed=`<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://example.org/"><title>Atom</title><entry><id>abc</id><title>Title</title><link href="post"/><author><name>Author</name></author><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Body</p></div></content><updated>2026-10-20T10:00:00Z</updated></entry></feed>`;
  const a=(await parseFeed(feed,'https://example.org/feed','s')).items[0];
  assert.equal(a.article.url,'https://example.org/post');assert.equal(a.article.author,'Author');assert.match(a.body.html,/Body/);
  await assert.rejects(parseFeed('<html><body>login</body></html>','https://a.test','s'),/不是/);
  await assert.rejects(parseFeed('<rss><channel>','https://a.test','s'),/解析/);
  await assert.rejects(parseFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>','https://a.test','s'),/DTD/);
});
test('OPML preserves groups, accepts only HTTP URLs and deduplicates',()=>{
  const result=parseOpml('<opml><body><outline text="外刊"><outline text="A" xmlUrl="https://a.test/feed"/><outline text="Duplicate" xmlUrl="https://a.test/feed"/><outline xmlUrl="file:///x"/></outline></body></opml>');
  assert.equal(result.length,1);assert.equal(result[0].group,'外刊');
});
test('feed HTML cannot execute script, style, forms, SVG, event handlers or unsafe URL protocols',()=>{
  const cleaned=safeHtml('<script>evil()</script><style>body{display:none}</style><img src="x.jpg" onerror="evil()"><a href="javascript:evil()">X</a><iframe src="https://evil.test"></iframe><svg onload="evil()"/><form><input autofocus/></form>','https://news.test/a');
  assert.doesNotMatch(cleaned,/<script|<style|onerror|javascript:|<iframe|<svg|<form|autofocus/);
  assert.match(cleaned,/https:\/\/news.test\/x.jpg/);
  assert.equal(canonicalUrl('file:///x'),'');assert.equal(canonicalUrl('https://user:pass@test.com'),'');
});
test('cover screening excludes avatar/logo/pixels and extreme decorations',()=>{
  for(const name of ['avatar.jpg','logo.png','favicon.ico','tracking.png'])assert.equal(imageCandidate(name,'https://x.test'),undefined);
  assert.equal(imageCandidate('a.jpg','https://x.test',1,1),undefined);
  assert.equal(imageCandidate('a.jpg','https://x.test',1000,100),undefined);
  assert.equal(imageCandidate('a.jpg','https://x.test',800,600),'https://x.test/a.jpg');
});
test('source union AND tag union, group browsing and later filtering',()=>{
  const s=initialState();s.sources=['a','b','c'].map(id=>({id,url:`https://${id}.test`,title:id,group:id==='c'?'other':'group',tags:[]}));
  s.articles=[article('1','a',['growth']),article('2','b',['growth','ai']),article('3','c',['growth'])];s.articles[1].later=true;
  assert.equal(filterArticles(s,{...allFilter(),mode:'group',value:'group'}).length,2);
  assert.deepEqual(filterArticles(s,{mode:'custom',sourceIds:['a','b'],tags:['growth','ai']}).map(x=>x.id),['1','2']);
  assert.deepEqual(filterArticles(s,{mode:'custom',sourceIds:['b'],tags:['ai','missing']}).map(x=>x.id),['2']);
  assert.equal(filterArticles(s,{mode:'custom',sourceIds:[],tags:[]}).length,0);
  assert.deepEqual(filterArticles(s,{...allFilter(),mode:'later'}).map(x=>x.id),['2']);
  assert.equal(groupSelection(['a','b'],new Set(['a'])),'partial');assert.equal(groupSelection(['a','b'],new Set(['a','b'])),'all');
});
test('refresh preserves later/import state and does not downgrade extracted content',()=>{
  const old={...article('1'),later:true,importedId:'doc',contentKind:'extracted' as const};
  const result=mergeArticles([old],[article('1'),article('1')]);
  assert.equal(result.length,1);assert.equal(result[0].later,true);assert.equal(result[0].importedId,'doc');assert.equal(result[0].contentKind,'extracted');
});
test('repository writes serialize; failed writes do not publish saved state; corrupt load is not reset',async()=>{
  const m=memory(),repo=new Repository(m.io);await repo.load();
  await Promise.all([repo.update(s=>s.groups.push('a')),repo.update(s=>s.groups.push('b'))]);assert.deepEqual(repo.state.groups,['a','b']);
  m.fail();await assert.rejects(repo.update(s=>s.groups.push('lost')));assert.deepEqual(repo.state.groups,['a','b']);
  const corrupt=memory();corrupt.files.set('state.json',{version:999});await assert.rejects(new Repository(corrupt.io).load());assert.equal((corrupt.files.get('state.json') as {version:number}).version,999);
});
test('image LRU capacity and expiry are bounded',()=>{
  const now=Date.now(),entries={a:{path:'a',url:'a',used:now-31*86400_000,bytes:20},b:{path:'b',url:'b',used:now-100,bytes:50},c:{path:'c',url:'c',used:now,bytes:70}};
  assert.deepEqual(evictions(entries,100,now),['a','b']);assert.deepEqual(evictions(entries,1000,now),['a']);assert.equal(evictions(entries,0,now).length,3);
});
test('Inbox creates real root document, records metadata, survives retry and prevents duplicate click',async()=>{
  const m=memory(),repo=new Repository(m.io);await repo.load();const a=article('a');await repo.update(s=>{s.articles=[a];s.settings.inboxNotebook='old-preference';});
  const calls:{path:string;body:Record<string,unknown>}[]=[];let created=0;let attrs:unknown;
  const api:Kernel=async<T>(path:string,body:Record<string,unknown>):Promise<T>=>{
    calls.push({path,body});let out:unknown;
    if(path.endsWith('getIDsByHPath'))out=[];
    else if(path.endsWith('createDocWithMd')){created++;out='20261020120000-testaaa';assert.equal(body.notebook,'root-inbox');}
    else if(path.endsWith('setBlockAttrs')){attrs={...(attrs as object),...(body.attrs as object)};out=null;}
    else if(path.endsWith('getPathByID'))out={notebook:'root-inbox',path:'/20261020120000-testaaa.sy'};
    else if(path.endsWith('getBlockAttrs'))out=attrs;
    else if(path.endsWith('/sql'))out=[{id:'20261020120000-testaaa'}];
    return out as T;
  };
  const bridge={version:1 as const,register:()=>()=>{},open:()=>{},close:()=>{},rootInboxTargets:async()=>{throw Error('legacy placement');},importTarget:async(preferred?:string)=>{assert.equal(preferred,undefined);return {id:'root-inbox',name:'未分类'};}};
  const service={read:async()=>({html:'<p>Summary content</p>',kind:'summary'})} as unknown as RssService;
  const inbox=new Inbox(repo,service,api,()=>bridge,undefined,async()=>({title:'中文标题',html:'<p>中文摘要</p>'}));
  const ids=await Promise.all([inbox.import(a),inbox.import(a)]);
  assert.equal(ids[0],ids[1]);assert.equal(created,1);assert.equal(repo.state.imports.a.completed,true);assert.equal((attrs as Record<string,string>)['custom-inl-status'],undefined);
  await inbox.import(a);assert.equal(created,1);assert.ok(calls.some(c=>c.path.endsWith('getBlockAttrs')));
  const md=calls.find(c=>c.path.endsWith('createDocWithMd'))!.body.markdown as string;
  assert.ok(md.startsWith('> 原文：'));assert.doesNotMatch(md,/^# /m);assert.doesNotMatch(md,/内容：/);assert.match(md,/https:\/\/news.test\/a/);
});
test('Inbox refuses missing or ambiguous Root role target without creating local inbox',async()=>{
  const m=memory(),repo=new Repository(m.io);await repo.load();let calls=0;
  const bridge={version:1 as const,register:()=>()=>{},open:()=>{},close:()=>{},rootInboxTargets:async()=>[{id:'a',name:'a'},{id:'b',name:'b'}]};
  const inbox=new Inbox(repo,{} as RssService,async<T>()=>{calls++;return null as T;},()=>bridge);
  await assert.rejects(inbox.import(article('x')),/打开一个笔记本/);assert.equal(calls,0);
});
