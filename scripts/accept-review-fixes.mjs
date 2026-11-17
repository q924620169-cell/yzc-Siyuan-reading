import {chromium} from 'playwright';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const phase=process.argv[2]||'upgrade',workspace=path.resolve(process.env.REVIEW_WORKSPACE||'.local/review-fixes-workspace'),base=process.env.REVIEW_URL||'https://127.0.0.1:51486';
const report={phase,version:'',checks:[],errors:[]},check=(name,value,details)=>{assert(value,name);report.checks.push({name,pass:true,...details});console.log('PASS',name,details?JSON.stringify(details):'');};
await mkdir('validation',{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000},userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'});
let page;
async function open(){page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.addInitScript(()=>document.addEventListener('yr:error',e=>console.error('Reader error: '+e.detail)));page.on('console',m=>{if(m.type()==='error'&&m.text().startsWith('Reader error:'))report.errors.push(m.text());});await page.goto(base+'/stage/build/desktop/');await page.waitForFunction(()=>window.siyuan?.ws?.app?.plugins);await page.evaluate(()=>{window.testApi=async(route,body={})=>{const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(data.code!==0)throw Error(data.msg);return data.data;};});report.version=await page.evaluate(()=>testApi('/api/system/version'));}
async function library(name){await page.waitForFunction(name=>window.siyuan.ws.app.plugins.find(p=>p.name===name)?.[name==='yzc-Reader'?'ready':'started'],name,{timeout:180000});await page.evaluate(name=>{window.p=window.siyuan.ws.app.plugins.find(p=>p.name===name);window.reader=name==='yzc-Reader'?p:p.reader;},name);}
async function readyPDF(){await page.waitForFunction(()=>reader.pdfTab?.model?.pdfObject?.isInitialViewSet&&reader.pdfTab.model.pdfObject.pdfViewer&&!reader.pdfTab.model.element.hasAttribute('data-loading'),{},{timeout:30000});await page.waitForTimeout(600);}
async function pdfState(){return page.evaluate(()=>{const obj=reader.pdfTab.model.pdfObject,v=obj.pdfViewer;return{path:reader.pdfTab.model.path,fingerprint:obj.pdfDocument?.fingerprints?.[0]||v.pdfDocument?.fingerprints?.[0],page:v.currentPageNumber,pages:v.pagesCount,top:v._location?.top};});}
async function diskHistory(fingerprint){for(let n=0;n<30;n++){const local=JSON.parse(await readFile(workspace+'/data/storage/local.json','utf8'));const history=JSON.parse(local['pdfjs.history']||'{"files":[]}').files.find(f=>f.fingerprint===fingerprint);if(history?.page===3)return history;await new Promise(r=>setTimeout(r,200));}throw Error('Legacy PDF page 3 not persisted');}
function fivePagePDF(){const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R 10 0 R 12 0 R] /Count 5 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];for(let i=0;i<5;i++){const content=`BT /F1 24 Tf 72 720 Td (Legacy resume page ${i+1} of 5) Tj ET`;objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`,`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);}let pdf='%PDF-1.7\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R /ID [<8bc35fea65fa423dbe896cb621393bd4><8bc35fea65fa423dbe896cb621393bd4>] >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(pdf);}
try{
 await open();
 if(phase==='baseline'){
  for(const name of ['yzc-Reader','yzc-RSS'])await page.evaluate(name=>testApi('/api/petal/setPetalEnabled',{packageName:name,enabled:true,app:'review-fixes-baseline'}),name);
  await library('yzc-Reader');await page.evaluate(()=>reader.open());
  // First capture an actual old course PDF with a nonzero native reading offset.
  const originalHistory=JSON.parse(JSON.parse(await readFile(workspace+'/data/storage/local.json','utf8'))['pdfjs.history']||'{"files":[]}');
  const real=await page.evaluate(async()=>{const book=reader.library.books.find(b=>b.format==='PDF'&&b.kind==='系列课程');const manifest=await reader.ui.courseManifest(book);const article=manifest.articles.find(a=>(a.file||a.path||'').toLowerCase().endsWith('.pdf'))||manifest.articles[0];await reader.ui.read(book,article.id);return{book:book.id,article:article.id};});
  await readyPDF();const realState=await pdfState(),saved=originalHistory.files.find(f=>f.fingerprint===realState.fingerprint);assert(saved);
  check('real legacy PDF opens at its saved page',realState.page===saved.page,{page:realState.page,top:realState.top,priorSavedTop:saved.scrollTop});
  await page.evaluate(()=>reader.ui.back());await page.waitForFunction(()=>!reader.ui.current&&reader.ui.shelfArea?.isConnected&&!reader.ui.releasingView);
  const bytes=fivePagePDF().toString('base64');await page.evaluate(bytes=>{void reader.ui.importFile(new File([Uint8Array.from(atob(bytes),c=>c.charCodeAt(0))],'resume-review-five-pages.pdf'));},bytes);
  await page.getByRole('button',{name:'加入书库',exact:true}).click();await page.waitForFunction(()=>reader.library.books.some(b=>b.title==='resume-review-five-pages'));
  const done=page.getByRole('button',{name:'完成',exact:true});if(await done.count())await done.click();
  const book=await page.evaluate(()=>reader.library.books.find(b=>b.title==='resume-review-five-pages'));
  await page.evaluate(id=>reader.ui.read(reader.library.books.find(b=>b.id===id)),book.id);await readyPDF();
  await page.evaluate(()=>reader.pdfTab.model.pdfObject.pdfViewer.scrollPageIntoView({pageNumber:3}));await page.waitForFunction(()=>reader.pdfTab.model.pdfObject.pdfViewer.currentPageNumber===3);
  const fixture=await pdfState();fixture.history=await diskHistory(fixture.fingerprint);fixture.book=book.id;
  check('old Reader persisted a nondefault native PDF page',fixture.page===3&&fixture.pages===5,{page:fixture.page,pages:fixture.pages});
  await page.screenshot({path:'validation/review-pdf-before.png'});
  await writeFile('validation/review-pdf-baseline.json',JSON.stringify({real:{...real,...realState,saved},fixture},null,2));
  for(const name of ['yzc-Reader','yzc-RSS','yzc-INL'])await page.evaluate(name=>testApi('/api/petal/setPetalEnabled',{packageName:name,enabled:false,app:'review-fixes-upgrade'}),name);
 }else if(phase==='upgrade'){
  let injected=false;
  const rssDir=workspace+'/data/storage/petal/yzc-INL/rss',marker=workspace+'/data/storage/petal/yzc-INL/modules-migration-v2.json';
  await page.route('**/api/file/putFile',async route=>{
   if(!injected&&route.request().postDataBuffer()?.includes(Buffer.from('/data/storage/petal/yzc-INL/rss/state.json.inl-migration-v2.tmp'))){
    const response=await route.fetch();injected=true;await writeFile(rssDir+'/state.json.inl-migration-v2.tmp','{injected temporary corruption');await route.fulfill({response});
   }else await route.continue();
  });
  await page.evaluate(()=>testApi('/api/petal/setPetalEnabled',{packageName:'yzc-INL',enabled:true,app:'review-fixes-upgrade'}));
  await page.waitForFunction(()=>document.body.innerText.includes('迁移临时文件校验失败'),{},{timeout:180000});
  check('real storage rejects corrupt staging before replacing the existing file',injected&&(await readFile(rssDir+'/state.json','utf8'))==='{v1 damaged state');
  check('failed migration has no completion marker',!(await readdir(path.dirname(marker))).includes(path.basename(marker)));
  await page.close();await context.unroute('**/api/file/putFile');await open();await library('yzc-INL');
  check('retry repairs malformed v1 destination and commits v2 marker',JSON.parse(await readFile(marker,'utf8')).completed&&JSON.parse(await readFile(rssDir+'/state.json','utf8')).version===2);
  const backups=(await readdir(rssDir)).filter(f=>f.startsWith('state.json.inl-invalid-')&&f.endsWith('.bak'));
  check('damaged old destination preserved as backup',backups.length>0&&(await readFile(rssDir+'/'+backups[0],'utf8'))==='{v1 damaged state');
  check('valid existing library config wins',await page.evaluate(()=>reader.library.config.lists.includes('review-existing-data-kept')));
  const baseline=JSON.parse(await readFile('validation/review-pdf-baseline.json','utf8'));
  await page.evaluate(()=>reader.open());
  await page.evaluate(real=>reader.ui.read(reader.library.books.find(b=>b.id===real.book),real.article),baseline.real);await readyPDF();
  const real=await pdfState();check('real old PDF retains page, fingerprint and reading offset after upgrade',real.path===baseline.real.path&&real.fingerprint===baseline.real.fingerprint&&real.page===baseline.real.page&&Math.abs(real.top-baseline.real.top)<=2,{page:real.page,beforeTop:baseline.real.top,afterTop:real.top});
  await page.evaluate(()=>reader.ui.back());await page.waitForFunction(()=>!reader.ui.current&&reader.ui.shelfArea?.isConnected&&!reader.ui.releasingView);
  await page.evaluate(id=>reader.ui.read(reader.library.books.find(b=>b.id===id)),baseline.fixture.book);await readyPDF();
  const resumed=await pdfState();check('upgraded PDF resumes at legacy page 3 of 5',resumed.page===3&&resumed.path===baseline.fixture.path&&resumed.fingerprint===baseline.fixture.fingerprint,{page:resumed.page,pages:resumed.pages});
  await page.screenshot({path:'validation/review-pdf-after.png'});
  const fallback=await page.evaluate(async()=>{
   const {notebooks}=await testApi('/api/notebook/lsNotebooks'),first=notebooks.find(n=>!n.closed);
   const oldNav=await p.loadData('document-navigation.json');
   const id=await testApi('/api/filetree/createDocWithMd',{notebook:first.id,path:'/review-deleted-home-'+Date.now(),markdown:''});
   await p.saveData('document-navigation.json',{...oldNav,homeId:id});await testApi('/api/filetree/removeDocByID',{id});
   await p.saveData('rss-inbox-targets.json',[]);await p.rss.repo.update(s=>{s.settings.inboxNotebook='';});
   const target=await p.bridge.api.importTarget();
   const article={id:'review-deleted-home-import',sourceId:'review-source',guid:'review-deleted-home-import',title:'失效主页导入回归',url:'https://fixture.invalid/review-home',author:'验收',published:Date.now(),summary:'中文正文',tags:[],later:false,contentKind:'feed'};
   await p.rss.repo.saveBody(article.id,{html:'<p>主页删除后，文章仍能转入未分类。</p>',kind:'feed',checkedPage:true});
   await p.rss.repo.update(s=>{s.sources.push({id:'review-source',url:'https://fixture.invalid/feed',title:'回归来源',group:'回归',groups:['回归'],tags:[]});s.articles.push(article);});
   const document=await p.rss.view.options.inbox.import(article),again=await p.rss.view.options.inbox.import(article),attrs=await testApi('/api/attr/getBlockAttrs',{id:document});
   const location=await testApi('/api/filetree/getPathByID',{id:document});await p.saveData('document-navigation.json',oldNav);
   return{first:first.id,target:target.id,notebook:location.notebook,uncategorized:attrs['custom-inl-status']==='inbox',same:document===again,completed:p.rss.repo.state.imports[article.id].completed};
  });
  check('deleted home falls back and imports exactly once into uncategorized',fallback.first===fallback.target&&fallback.target===fallback.notebook&&fallback.uncategorized&&fallback.same&&fallback.completed);
 }else if(phase==='restart'){
  await library('yzc-INL');const baseline=JSON.parse(await readFile('validation/review-pdf-baseline.json','utf8'));
  await page.evaluate(()=>reader.open());await page.evaluate(id=>reader.ui.read(reader.library.books.find(b=>b.id===id)),baseline.fixture.book);await readyPDF();
  const state=await pdfState();check('PDF page 3 survives full kernel restart',state.page===3&&state.path===baseline.fixture.path&&state.fingerprint===baseline.fixture.fingerprint,{page:state.page,pages:state.pages});
  check('v2 migration and recovered RSS data persist',await page.evaluate(async()=>!!(await p.loadData('modules-migration-v2.json'))?.completed&&!!p.rss.repo.state.imports['review-deleted-home-import']?.completed));
 }else throw Error('Unknown acceptance phase');
 check('no runtime page errors',report.errors.length===0);
}finally{await writeFile(`validation/review-fixes-${phase}.json`,JSON.stringify(report,null,2));await browser.close();}
