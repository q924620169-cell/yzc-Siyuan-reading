import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
await mkdir('validation',{recursive:true});
const output=await build({entryPoints:['plugin/src/adapters/shell-layout-adapter.ts'],bundle:true,write:false,format:'iife',globalName:'YZCShell'});
const rssOutput=await build({entryPoints:['modules/rss/tests/browser-entry.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const rssHtml=`<!doctype html><html data-theme-mode="light" data-style="notion"><head><meta charset="utf-8"><link id="pluginsStyleyzc-Siyuan-reading" rel="stylesheet" href="/index.css"><style>html,body{margin:0;height:100%;font-family:Arial}body{display:flex;background:#fff}#sidebar{width:304px;flex:none;height:100%;overflow:auto;border-right:1px solid #ddd}#reader{flex:1;min-width:0;height:100%}#messages{position:fixed;right:0;bottom:0;background:#fff;font:11px Arial;z-index:9}</style></head><body><div id="sidebar"></div><div id="reader"></div><div id="messages"></div><script type="module" src="/rss-entry.js"></script></body></html>`;
const html=`<!doctype html><html data-light-theme="daylight"><head><style>
html,body{margin:0;height:100%}body{display:flex;flex-direction:column;font-family:Arial}#toolbar{height:32px;flex:none;display:flex;align-items:center;box-sizing:border-box}#barWorkspace{width:180px}#drag{flex:1;height:100%}.toolbar__item{height:28px}.yzc-windows{flex:none!important;max-width:none!important}#layouts{display:flex;flex:1;min-height:0}#dockLeft{width:42px;flex:none}.layout__dockl{width:260px;flex:none}.layout__center{display:flex;flex-direction:column;flex:1;min-width:0}.protyle{position:relative;display:flex;flex-direction:column;flex:1;min-height:0;container-type:inline-size}.protyle-content{overflow:auto;flex:1;min-height:0}.protyle-wysiwyg{padding:20px max(12px,calc((100cqw - 900px)/2));box-sizing:border-box}.protyle-title__input{padding:20px 40px}.code-block{height:900px;margin:0;padding:16px;white-space:pre;overflow:auto}.layout-tab-bar{display:flex}#status{display:flex;height:24px;flex:none;background:#ccc}.status__counter{margin-left:auto}#statusHelp{margin-left:8px}#native-row{height:30px}
</style><link id="pluginsStyleyzc-Siyuan-reading" rel="stylesheet" href="/index.css"></head><body>
<div id="toolbar"><button id="barWorkspace" class="toolbar__item">Workspace</button><nav class="yzc-windows"><div class="yzc-window-strip"><div class="yzc-window" data-active="true"><button role="tab">视觉文案</button></div></div><div class="yzc-window-actions"><button>+</button><button>⌄</button></div></nav><div id="drag"></div><button class="toolbar__item">System</button></div>
<div id="layouts"><div id="dockLeft"></div><aside class="layout__dockl">Sidebar</aside><main class="layout__center"><div data-type="wnd"><div id="native-row" class="fn__flex"><ul class="layout-tab-bar">Native tabs</ul></div></div><div class="protyle yzc-has-outline"><div class="protyle-content"><div class="protyle-title"><div class="protyle-title__input">视觉文案 · 独立阶段</div></div><div class="protyle-wysiwyg"><div data-type="NodeHeading" data-subtype="h1">当前版本</div><div data-type="NodeParagraph">中文正文 English reading body.</div><div data-type="NodeHeading" data-subtype="h4">下级标题</div><div data-type="NodeCodeBlock" class="code-block">${'sample code line\n'.repeat(60)}</div></div></div><nav class="yzc-scrollspy"><div class="yzc-scrollspy-ticks">${'<i class="yzc-heading-tick"></i>'.repeat(8)}</div><div class="yzc-scrollspy-panel"><button>当前版本</button></div></nav></div></main></div><div id="status"><span class="status__counter">字符 123 字 45 块 8</span><span id="statusHelp">?</span></div></body></html>`;
const server=createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);return;}
  if(req.url?.startsWith('/rss-entry.js')){res.setHeader('Content-Type','application/javascript;charset=utf-8');res.end(rssOutput.outputFiles[0].text);return;}
  if(req.url?.startsWith('/rss')){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(rssHtml);return;}
  const file=path.resolve('dist/package','.'+decodeURIComponent(req.url.split('?')[0]).replace(/^\/plugins\/yzc-Siyuan-reading/,''));
  if(!file.startsWith(path.resolve('dist/package')+path.sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'font/ttf');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)}),report={environment:'Chromium real layout; Default Light fixture; Windows and synthetic macOS geometry',cases:[]};
async function checkFusion() {
  const {outputFiles}=await build({entryPoints:['plugin/src/adapters/window-adapter.ts'],bundle:true,write:false,format:'iife',globalName:'YZCWindows'});
  const page=await browser.newPage({viewport:{width:960,height:650}});
  page.setDefaultTimeout(8000);
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    // Reproduce SiYuan's two overlapping titlebar layers and the native drag edges.
    await page.goto(base);
    await page.setContent(`<!doctype html><link id="pluginsStyleyzc-Siyuan-reading" rel="stylesheet" href="${base}/index.css"><style>
      body{margin:0}#toolbar{height:42px;width:100%;display:flex;align-items:center}
      #toolbar>button{flex:0 0 140px;height:40px}#drag{flex:1;height:42px}
      .body--toolbar-hide #toolbar{position:absolute;z-index:7;top:0}
      .body--toolbar-hide #drag{position:relative;-webkit-app-region:none}
      #drag::before,#drag::after{content:'';position:absolute;width:8px;height:42px;top:0}
      #drag::before{left:0}#drag::after{right:0}
      #layouts{display:flex}.layout__center{flex:1}#left-dock{width:240px}#right-dock{width:60px}
      .native-row{display:flex;min-height:42px;box-sizing:border-box}
      .layout-tab-bar{display:flex;list-style:none;margin:0;padding:0;align-items:center;min-width:0}
      .layout-tab-bar--readonly{flex:1;min-width:56px;margin-right:88px}
      .layout-tab-container{height:240px}#native-tool{height:100px}
    </style><body class="body--toolbar-hide"><div id="toolbar"><button>Workspace</button><div id="drag"></div><button id="settings">Settings</button></div>
    <div id="layouts"><aside id="left-dock"></aside><main class="layout__center"><div class="layout__wnd--active" data-type="wnd">
      <div class="native-row fn__flex"><ul class="layout-tab-bar"><li data-type="tab-header"><button id="native-tab">搜索</button></li></ul><ul class="layout-tab-bar layout-tab-bar--readonly"><li class="item--readonly"><span data-type="new">+</span><span class="fn__flex-1"></span></li></ul></div>
      <div class="layout-tab-container"><article id="native-tool">原生工具内容</article></div>
    </div></main><aside id="right-dock"></aside></div></body>`);
    await page.addScriptTag({content:outputFiles[0].text});
    await page.evaluate(()=>{
      let foreign=false;
      const note={id:'note',title:'文档',token:'note'};
      const host={active:()=>foreign?undefined:note,documents:()=>[note],foreign:()=>foreign,open:async()=>note,close:()=>{},subscribe:()=>()=>{}};
      window.windowsAdapter=new YZCWindows.WindowAdapter(host,null,()=>{},error=>{throw error;});
      window.showNative=()=>{
        foreign=true;
        document.querySelector('[data-type="tab-header"]').classList.add('item--focus');
      };
      document.querySelector('#settings').onclick=()=>{document.body.dataset.settingsClick='true';};
      document.querySelector('#native-tab').onclick=()=>{document.body.dataset.nativeClick='true';};
    });
    await page.getByRole('button',{name:'Settings'}).click();
    assert.equal(await page.locator('body').getAttribute('data-settings-click'),'true');
    const add=page.getByRole('button',{name:'新增窗口'});
    await add.click();
    await page.setViewportSize({width:740,height:650});
    await add.click();
    await page.locator('.native-row').evaluate(row=>{row.style.visibility='hidden';});
    await page.locator('.yzc-windows[data-yzc-window-fallback]').waitFor();
    await add.click();
    await page.locator('.native-row').evaluate(row=>{row.style.visibility='';});
    await page.locator('.native-row > .yzc-windows').waitFor();
    assert.equal(await page.locator('.native-row > .yzc-windows [role="tab"]').count(),4);
    assert.ok(await page.locator('.yzc-window-empty').isVisible());
    assert.equal(await page.locator('#native-tool').isVisible(),false);
    await page.evaluate(()=>showNative());
    await page.locator('#native-tab').click();
    assert.equal(await page.locator('body').getAttribute('data-native-click'),'true');
    assert.ok(await page.locator('#native-tool').isVisible());
    assert.equal(await add.isVisible(),false);
    assert.equal(await page.locator('.layout-tab-bar--readonly').evaluate(el=>el.parentElement.lastElementChild===el),true);
    await page.evaluate(()=>windowsAdapter.dispose());
    assert.ok(await page.locator('#native-tool').isVisible());
    assert.equal(await page.locator('[data-yzc-window-bar], [data-yzc-native-tabs], [data-yzc-window-empty]').count(),0);
    console.log('PASS fused toolbar click-through, explicit windows, native tab and panel, and cleanup');
  } finally { await page.close(); }
}

try{
  await checkFusion();
  const page=await browser.newPage({viewport:{width:1536,height:900}});await page.goto(`http://127.0.0.1:${server.address().port}/`);
  // Before any JS state/adapter, the static CSS already establishes the base.
  const prepaint=await page.evaluate(()=>({color:getComputedStyle(document.body).backgroundColor,native:getComputedStyle(document.querySelector('#native-row')).display,attributes:document.documentElement.hasAttribute('data-sv-theme')}));
  if(prepaint.color!=='rgb(255, 255, 255)'||prepaint.native!=='none'||prepaint.attributes)throw Error('Static base depends on async JS/theme activation');
  await page.addScriptTag({content:output.outputFiles[0].text});await page.evaluate(()=>{window.shell=new YZCShell.ShellLayoutAdapter(document);});
  for(const [name,width,sidebar,padding,height] of [['wide',1536,260,0,32],['narrow',900,360,0,32],['mac-geometry',1200,260,80,44]]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(({sidebar,padding,height})=>{document.querySelector('.layout__dockl').style.width=sidebar+'px';document.querySelector('#toolbar').style.paddingLeft=padding+'px';document.querySelector('#toolbar').style.height=height+'px';document.querySelector('.protyle-content').scrollTop=0;},{sidebar,padding,height});
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.protyle')).getPropertyValue('--yzc-editor-width')===document.querySelector('.protyle').getBoundingClientRect().width+'px');
    const result=await page.evaluate(()=>{const q=s=>document.querySelector(s),r=s=>{const b=q(s).getBoundingClientRect();return{left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width};},s=sel=>getComputedStyle(q(sel));return{pane:r('.protyle'),code:r('.code-block'),ticks:r('.yzc-scrollspy-ticks'),content:r('.protyle-content'),status:r('#status'),nav:r('.yzc-windows'),gutter:s('.protyle').getPropertyValue('--yzc-right-utility-gutter'),counterBg:s('.status__counter').backgroundColor,counterShadow:s('.status__counter').boxShadow,toolbarDrag:s('#toolbar').getPropertyValue('-webkit-app-region'),tabDrag:s('.yzc-window').getPropertyValue('-webkit-app-region'),bodySize:s('.protyle-wysiwyg').fontSize};});
    if(result.code.right>result.ticks.left-6)throw Error(name+': code/scrollspy collide '+JSON.stringify(result));
    if(Math.abs(result.content.bottom-900)>.5)throw Error(name+': a footer row still shortens the editor');
    if(result.counterBg!=='rgba(0, 0, 0, 0)'||result.counterShadow!=='none')throw Error(name+': solid counter card');
    if(name==='wide'&&result.gutter!=='0px')throw Error('Wide layout shrunk');
    if(name==='narrow'&&!(parseFloat(result.gutter)>0))throw Error('Narrow pane has no measured gutter');
    if(result.nav.left<padding||result.toolbarDrag!=='drag'||result.tabDrag!=='no-drag')throw Error(name+': titlebar/traffic-light/drag contract');
    await page.evaluate(()=>{const el=document.querySelector('.protyle-content');el.scrollTop=el.scrollHeight;});
    const bottom=await page.evaluate(()=>({code:document.querySelector('.code-block').getBoundingClientRect().bottom,status:document.querySelector('#status').getBoundingClientRect().top}));
    if(bottom.code>bottom.status+.5)throw Error(name+': code end obscured by floating stats');
    report.cases.push({name,...result,bottom});await page.screenshot({path:`validation/${name}.png`});
  }
  await page.evaluate(()=>{document.documentElement.dataset.style='anthropic';document.documentElement.dataset.typography='anthropic';document.querySelector('.protyle-content').scrollTop=0;});await page.evaluate(async()=>{
    // A ready promise captured before style changes request the font can already be resolved.
    await document.fonts.load('30px "LXGW ZhenKai GB"','视觉文案当前版本独立阶段');
    await document.fonts.ready;
  });
  const fonts=await page.evaluate(()=>{const s=sel=>getComputedStyle(document.querySelector(sel));return{loaded:document.fonts.check('30px "LXGW ZhenKai GB"','视觉文案当前版本独立阶段'),heading:s('.protyle-title__input').fontFamily,lower:s('[data-subtype="h4"]').fontFamily,body:s('.protyle-wysiwyg').fontFamily,size:s('.protyle-wysiwyg').fontSize,line:s('.protyle-wysiwyg').lineHeight,weight:s('.protyle-title__input').fontWeight,synthesis:s('.protyle-wysiwyg').fontSynthesis};});
  if(!fonts.loaded||!fonts.heading.includes('ZhenKai')||!fonts.lower.includes('ZhenKai')||fonts.body.includes('ZhenKai')||fonts.size!=='17px'||fonts.weight!=='400'||fonts.synthesis!=='none')throw Error('Font separation failed '+JSON.stringify(fonts));
  await page.screenshot({path:'validation/anthropic-headings.png'});report.fonts=fonts;
  await page.evaluate(()=>{window.shell.dispose();document.querySelector('#pluginsStyleyzc-Siyuan-reading').remove();});
  const off=await page.evaluate(()=>({native:getComputedStyle(document.querySelector('#native-row')).display,status:getComputedStyle(document.querySelector('#status')).position,gutter:document.querySelector('.protyle').style.getPropertyValue('--yzc-right-utility-gutter')}));
  if(off.native==='none'||off.status!=='static'||off.gutter)throw Error('Static visual layer persists after removal');
  const rssPage=await browser.newPage({viewport:{width:1360,height:800}}),rssErrors=[];rssPage.on('pageerror',error=>rssErrors.push(error.message));
  try{
    await rssPage.goto(base+'/rss');
    await rssPage.waitForFunction(()=>window.fixture?.repo);
    await rssPage.evaluate(async()=>{
      const fixture=window.fixture;
      fixture.service.refresh=async()=>({total:0,failed:0,skipped:0});
      await fixture.repo.update(state=>{
        state.groups=['个人成长'];
        state.sources=[
          {id:'dan',title:'Dan Koe — Future/Proof',url:'https://fixture.invalid/dan',type:'rss',group:'个人成长',groups:['个人成长'],tags:[]},
          {id:'derek',title:'Derek Sivers — Articles',url:'https://fixture.invalid/derek',type:'rss',group:'个人成长',groups:['个人成长'],tags:[]}
        ];
        state.articles=[
          {id:'article-1',sourceId:'dan',guid:'article-1',url:'https://fixture.invalid/1',title:'Uncorrelated perspectives',author:'Derek Sivers',summary:'Long-term investing.',published:Date.now(),tags:[],later:false,contentKind:'summary'},
          {id:'article-2',sourceId:'derek',guid:'article-2',url:'https://fixture.invalid/2',title:'Make Learning Permanent',author:'Scott H. Young',summary:'Remember what you learn.',published:Date.now()-1000,tags:[],later:false,contentKind:'summary'}
        ];
      });
      fixture.view.renderSidebar();fixture.view.renderList();
    });
    const group=rssPage.getByRole('button',{name:'个人成长',exact:true}),toggle=rssPage.locator('.rss-group-toggle'),children=rssPage.locator('.rss-group-children');
    await group.waitFor();
    const icons=await rssPage.locator('.rss-sidebar').evaluate(node=>({count:node.querySelectorAll('svg.rss-icon').length,uses:node.querySelectorAll('svg.rss-icon use').length,masks:[...node.querySelectorAll('svg.rss-icon')].filter(icon=>getComputedStyle(icon).maskImage!=='none').length,geometry:[...node.querySelectorAll('svg.rss-icon')].every(icon=>!!icon.querySelector('path,circle'))}));
    assert.ok(icons.count>=7);assert.equal(icons.uses,0);assert.equal(icons.masks,0);assert.equal(icons.geometry,true);
    assert.equal(await rssPage.locator('.rss-page-actions svg path').count(),2);
    assert.equal(await group.locator('.rss-tree-book .rss-icon').getAttribute('data-asset'),'book');
    assert.equal(await rssPage.locator('.rss-tree-source .rss-tree-document .rss-icon').count(),2);
    assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    await toggle.click();await rssPage.waitForTimeout(250);
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await children.isVisible(),false);
    await toggle.click();await rssPage.waitForTimeout(250);
    assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.equal(await children.isVisible(),true);
    await group.click();await rssPage.waitForTimeout(100);
    assert.equal((await rssPage.locator('.rss-page-title').textContent())?.trim(),'个人成长');
    assert.equal(await group.getAttribute('aria-current'),'true');assert.equal(await children.isVisible(),true);
    assert.deepEqual(rssErrors,[]);
    await rssPage.screenshot({path:'validation/rss-document-tree.png'});
    report.rssNavigation={passed:true,icons,tree:'separate disclosure, book/document icons, count, group filtering'};
  }finally{await rssPage.close();}
  report.prepaint=prepaint;report.off=off;report.passed=true;await writeFile('validation/unified-ui.json',JSON.stringify(report,null,2));console.log('PASS static prepaint, wide/narrow pane collision, transparent footer, synthetic Mac geometry, three fonts, inline RSS icons, document-tree groups, stylesheet removal');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
