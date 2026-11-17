import test from'node:test';
import assert from'node:assert/strict';
import{coverLines,ensureTextCovers,isTextCover,coverVersion}from'../src/covers.js';
import{currentBookmark,releaseReadingView}from'../src/reading-ui.js';
import{Library}from'../src/storage.js';

test('cover lines wrap CJK, words and continuous text within five lines',()=>{
 for(const title of ['课程文字标题'.repeat(20),'A remarkably long book title with several words '.repeat(4),'x'.repeat(130)]){
  const lines=coverLines(title,text=>[...text].length*20);
  assert(lines.length<=5);assert(lines.every(line=>[...line].length*20<=242));assert(lines.at(-1).endsWith('…'));
 }
 assert.deepEqual(coverLines('自然换行',text=>text.length*38,80),['自然','换行']);
});

test('cover migration retries safely and preserves real or replaced covers',async()=>{
 const oldDocument=global.document;
 global.document={createElement:()=>({getContext:()=>({font:'',measureText:text=>({width:text.length*20})})})};
 const library={books:[{id:'one',title:'Old',cover:'assets/yzc-reader/books/one/cover/generated-cover-v2.svg'},{id:'two',title:'Real',cover:'assets/yzc-reader/books/two/cover/cover.jpg'},{id:'three',title:'PDF'}],writes:[],
  async persist(_file,id,name){return'assets/yzc-reader/books/'+id+'/cover/'+name+'.svg';},
  async update(book,patch){this.writes.push(book.id);Object.assign(book,patch);},
 };
 try{
  await ensureTextCovers(library);assert.deepEqual(library.writes,['one','three']);
  assert(library.books[0].cover.includes(coverVersion));assert.equal(library.books[1].cover,'assets/yzc-reader/books/two/cover/cover.jpg');
  await ensureTextCovers(library);assert.equal(library.writes.length,2);
  library.books[0].cover='assets/yzc-reader/books/one/cover/generated-cover-v2.svg';
  library.persist=async()=>{library.books[0].cover='assets/manual.png';return'assets/generated-cover-v3.svg';};
  await ensureTextCovers(library);assert.equal(library.books[0].cover,'assets/manual.png');assert.equal(library.writes.length,2);
  assert(!isTextCover('assets/cover-user.jpg'));
  assert(!isTextCover('assets/generated-cover.svg'));
 }finally{global.document=oldDocument;}
});

test('bookmark state follows a saved point within the current viewport',()=>{
 const viewport={cfi:'epubcfi(/6/2!/4,/2/1:10,/8/1:10)'};
 const point={cfi:'epubcfi(/6/2!/4/4/1:20)'},other={cfi:'epubcfi(/6/4!/4/4/1:20)'};
 assert.equal(currentBookmark([other,point],viewport),point);
 assert.equal(currentBookmark([other],viewport),undefined);
 assert.equal(currentBookmark([{...point,unresolved:true}],viewport),undefined);
 assert.equal(currentBookmark([{cfi:'invalid'}],viewport),undefined);
 const savedViewport={cfi:'epubcfi(/6/2!/4,/2/1:0,/4/1:20)'};
 assert.equal(currentBookmark([savedViewport],viewport),savedViewport);
});

test('closing a reading view waits for queued styles before destroying resources',async()=>{
 const previous=global.requestAnimationFrame,steps=[];let finishFonts,frame;
 global.requestAnimationFrame=callback=>{frame=callback;};
 const fonts={ready:new Promise(resolve=>{finishFonts=resolve;})};
 const view={renderer:{getContents:()=>[{doc:{fonts}}]},close(){steps.push('close');},remove(){steps.push('remove');}};
 try{
  const closing=releaseReadingView(view,{destroy(){steps.push('destroy');}});
  assert.deepEqual(steps,[]);finishFonts();
  await new Promise(resolve=>setImmediate(resolve));assert(frame);assert.deepEqual(steps,[]);
  steps.push('render');frame();await closing;
  assert.deepEqual(steps,['render','close','remove','destroy']);
 }finally{global.requestAnimationFrame=previous;}
});

test('owned SVG validation reads original file bytes through the file API',async()=>{
 const originalFetch=global.fetch,files=new Map(),svg='<svg><text>Don&apos;t &amp; &lt;panic&gt;</text></svg>';
 global.fetch=async(url,options)=>{
  if(url==='/api/file/getFile'){const {path}=JSON.parse(options.body);return files.has(path)?new Response(files.get(path)):new Response('',{status:404});}
  if(url==='/api/file/putFile'){files.set(options.body.get('path'),await options.body.get('file').text());return Response.json({code:0});}
  throw Error('Resource rendering must not be used for byte validation');
 };
 try{const library=new Library();const path=await library.persistOwned(new File([svg],'cover.svg'),'20261111090000-abcdefg','cover/generated-cover-v3.svg');assert(path.endsWith('.svg'));assert.equal([...files.values()][0],svg);}
 finally{global.fetch=originalFetch;}
});
