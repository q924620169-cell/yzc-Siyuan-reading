import {mkdirSync} from 'node:fs';
mkdirSync('validation',{recursive:true});
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
await mkdir('.tmp/motion',{recursive:true});
const result=await build({entryPoints:['tests/browser/tree-motion-fixture.ts'],bundle:true,write:false,format:'iife',target:'es2022'});
const flatResult=await build({entryPoints:['tests/browser/flat-tree-motion-fixture.ts'],bundle:true,write:false,format:'iife',target:'es2022'});
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)});
try {
  const page=await browser.newPage({viewport:{width:1200,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const fixture = `<style>body{margin:0}.file-tree{width:320px}.file-tree__items{overflow:auto}.file-tree ul{padding:0;margin:0;list-style:none}.file-tree li{height:30px;line-height:30px;padding:0 8px;box-sizing:border-box}.file-tree .block__icons{display:flex}.b3-list-item__toggle{display:none}.b3-list-item__text{cursor:pointer}</style><style>${await readFile('plugin/styles/plugin.css','utf8')}</style>`;
  await page.setContent(fixture);
  await page.addScriptTag({content:result.outputFiles[0].text});
  const report=await page.evaluate(()=>window.runMotionChecks());
  await page.setContent(fixture);
  await page.addScriptTag({content:flatResult.outputFiles[0].text});
  const flat=await page.evaluate(()=>window.runFlatMotionChecks());
  if(errors.length)throw new Error(errors.join('\n'));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setContent('<div></div>');
  // Native timing respects the system setting; own Section/Focus transitions
  // must also disappear instead of leaving paused or zero-height elements.
  await page.addScriptTag({content:result.outputFiles[0].text});
  const reduced=await page.evaluate(async()=>{
    document.querySelector('[data-node-id="book"] .b3-list-item__text').click();
    await new Promise(resolve=>requestAnimationFrame(resolve));
    return {animations:document.getAnimations().length,sections:document.querySelectorAll('.yzc-section').length};
  });
  if(reduced.animations)throw Error('Reduced motion retains running animations');
  const reducedFlat=await browser.newPage({viewport:{width:1200,height:1000},reducedMotion:'reduce'});
  reducedFlat.on('pageerror',error=>errors.push(error.message));
  await reducedFlat.setContent(fixture);
  await reducedFlat.addScriptTag({content:flatResult.outputFiles[0].text});
  await reducedFlat.evaluate(()=>window.runFlatMotionChecks());
  if(errors.length)throw new Error(errors.join('\n'));
  await reducedFlat.close();
  await writeFile('validation/tree-motion.json',JSON.stringify({environment:'isolated Chromium host fixture, real WAAPI/layout, no user workspace',passed:true,...report,flat},null,2));
  console.log('PASS: native/Local/Sections/reopen/all-collapsed/Focus/interrupt/cleanup; flat hint geometry, switching and reduced motion');
} finally {await browser.close();}
