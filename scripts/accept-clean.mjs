import {chromium} from 'playwright';
import {writeFile,readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage();
const report={checks:[],errors:[]};page.on('pageerror',e=>report.errors.push(e.message));
page.on('response',async r=>{if(/\/api\/(notebook\/createNotebook|filetree\/createDocWithMd)$/.test(r.url()))console.log('API',r.url(),JSON.stringify(await r.json()).slice(0,600));});
const check=(name,value)=>{assert(value,name);report.checks.push({name,pass:true});console.log('PASS',name);};
try{
 await page.goto((process.env.CLEAN_TEST_URL||'https://127.0.0.1:51481')+'/stage/build/desktop/');
 await page.evaluate(async()=>{await fetch('/api/petal/setPetalEnabled',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({packageName:'yzc-INL',enabled:true,app:'merge-clean-acceptance'})});});
 await page.reload();
 await page.waitForFunction(()=>window.siyuan?.ws?.app?.plugins?.find(p=>p.name==='yzc-INL')?.started,{},{timeout:90000});
 await page.evaluate(()=>{window.p=window.siyuan.ws.app.plugins.find(p=>p.name==='yzc-INL');});
 await page.evaluate(()=>{window.acceptanceErrors=[];document.addEventListener('yr:error',e=>window.acceptanceErrors.push(String(e.detail)));});
 check('clean install has one plugin and no RSS subscriptions',await page.evaluate(()=>window.siyuan.ws.app.plugins.length===1&&p.rss.repo.state.sources.length===0));
 for(const id of ['document','yzc-Reader','yzc-RSS']){await page.locator(`[data-space="${id}"]`).click();await page.waitForTimeout(250);check('clean space '+id,await page.evaluate(id=>p.windows.activeSpace===id,id));}
 const target=await page.evaluate(async()=>{try{return !!(await p.bridge.api.importTarget()).id;}catch(e){return /打开一个笔记本/.test(e.message);}});
 check('fresh target resolves an open notebook or gives guidance',target);
 await page.locator('[data-space="yzc-Reader"]').click();await page.waitForTimeout(300);
 const assetRoot='.local/upgrade-workspace/data/assets/yzc-reader/books',files=await readdir(assetRoot,{recursive:true});
 for(const [ext,format]of [['epub','EPUB'],['pdf','PDF']]){
  const file=files.find(f=>f.toLowerCase().endsWith('.'+ext));assert(file,'original fixture '+ext);
  const exists=await page.evaluate(format=>p.reader.library.books.some(b=>b.format===format),format);
  if(!exists){const bytes=(await readFile(assetRoot+'/'+file)).toString('base64');
   await page.evaluate(({bytes,ext})=>{const raw=Uint8Array.from(atob(bytes),c=>c.charCodeAt(0));void p.reader.ui.importFile(new File([raw],'clean-fixture.'+ext)).catch(e=>console.error(e));},{bytes,ext});
   await page.getByRole('button',{name:'加入书库',exact:true}).click();}
  await page.waitForFunction(format=>p.reader.library.books.some(b=>b.format===format),format,{timeout:30000});
  const done=page.getByRole('button',{name:'完成',exact:true});if(await done.count())await done.click();
  await page.evaluate(async format=>{await p.reader.ui.read(p.reader.library.books.find(b=>b.format===format));},format);
  if(format==='EPUB')await page.waitForFunction(()=>p.reader.ui.view?.renderer?.getContents().some(c=>c.doc?.body?.textContent?.length>0));
  else await page.waitForFunction(()=>p.reader.pdfTab?.model?.path?.startsWith('assets/yzc-reader/books/')&&p.reader.pdfTab.model.pdfObject?.isInitialViewSet&&!p.reader.pdfTab.model.element.hasAttribute('data-loading'));
  check('clean original '+format+' opens with bundled resources',true);
  await page.evaluate(()=>p.reader.ui.back());await page.waitForFunction(()=>!p.reader.ui.current&&p.reader.ui.shelfArea?.isConnected&&!p.reader.ui.releasingView);
 }
 await page.screenshot({path:'validation/clean-bookshelf.png'});
 check('clean install no runtime errors',report.errors.length===0);
 }catch(e){console.log(await page.locator('body').innerText());console.log(await page.evaluate(()=>window.acceptanceErrors));await page.screenshot({path:'.local/clean-failure.png'});throw e;}finally{await writeFile('validation/clean-acceptance.json',JSON.stringify(report,null,2));await browser.close();}
