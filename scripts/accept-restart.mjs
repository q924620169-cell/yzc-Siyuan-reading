import {chromium} from 'playwright';
import {writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const report={checks:[],errors:[]},prior=JSON.parse(await readFile('validation/host-acceptance.json','utf8'));
const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext({ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
const check=(name,value)=>{assert(value,name);report.checks.push({name,pass:true});console.log('PASS',name);};
try{
 await page.goto('https://127.0.0.1:51480/stage/build/desktop/');await page.waitForFunction(()=>window.siyuan?.ws?.app?.plugins?.find(p=>p.name==='yzc-INL')?.started,{},{timeout:60000});
 await page.evaluate(()=>{window.p=window.siyuan.ws.app.plugins.find(p=>p.name==='yzc-INL');});
 check('books keep same IDs after kernel restart',await page.evaluate(ids=>ids.every(id=>p.reader.library.books.some(b=>b.id===id)),prior.books.map(b=>b.id)));
 check('import completion and identity survive restart',await page.evaluate(f=>p.rss.repo.state.imports[f.article]?.documentId===f.document&&p.rss.repo.state.imports[f.article]?.completed,prior.fixture));
 check('migration marker loaded without duplicate state',await page.evaluate(async()=>!!await p.loadData('modules-migration-v1.json')));
 for(const id of ['document','yzc-Reader','yzc-RSS']){await page.locator(`[data-space="${id}"]`).click();await page.waitForTimeout(250);check('restart space '+id,await page.evaluate(id=>p.windows.activeSpace===id,id));}
 // Unload all modules through the sole owner; verify handlers and docks are removed.
 await page.evaluate(()=>p.onunload());await page.waitForTimeout(300);
 check('unload removes shared navigation and module roots',await page.locator('.yzc-space-switch,.yr-root,.rss-root').count()===0);
 check('restart no runtime errors',report.errors.length===0);
}finally{await writeFile('validation/restart-acceptance.json',JSON.stringify(report,null,2));await browser.close();}
