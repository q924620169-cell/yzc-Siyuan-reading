import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';

const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function page() {return new JSDOM('<!doctype html><html data-light-theme="daylight" data-theme-mode="light"><head><link id="themeStyle" href="/appearance/themes/daylight/theme.css?v=1"></head><body><div id="toolbar"><div id="drag"></div></div><div class="layout__center"><div data-type="wnd"><div class="fn__flex"><ul class="layout-tab-bar"></ul></div><div class="layout-tab-container"></div></div></div><div class="sy__outline"><div class="block__icons">大纲</div><ul class="native">Native headings</ul></div><div class="file-tree"><div class="block__icons"></div><div class="file-tree__items"></div></div></body></html>',{pretendToBeVisual:true});}

test('unified plugin mounts on Default Light without a theme; host theme changes do not unmount; unload removes all resources',async()=>{
  const dom=page(),doc=dom.window.document;const listeners=new Map<string,Set<Function>>();
  const css=doc.createElement('style');css.id='pluginsStyleyzc-INL';doc.head.append(css);
  const storage=new Map<string,unknown>();let writes=0;
  class Plugin {
    name="yzc-INL";
    app={};
    eventBus={on:(key:string,fn:Function)=>{if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key)!.add(fn);},off:(key:string,fn:Function)=>listeners.get(key)?.delete(fn)};
    async loadData(key:string){return storage.get(key) ?? null;}
    async saveData(key:string,value:unknown){if(key==='windows.json')writes++;storage.set(key,JSON.parse(JSON.stringify(value)));}
    addTopBar({element}:any){element.id='yzc-test';doc.querySelector('#toolbar')!.append(element);return element;}
    removeTopBar(){doc.querySelector('#yzc-test')?.remove();}
  }
  const output=await build({entryPoints:['plugin/src/index.ts'],bundle:true,format:'cjs',platform:'node',external:['siyuan'],write:false,plugins:[{name:'module-lifecycle-fixture',setup(b){b.onLoad({filter:/modules[\\/](reader|rss)[\\/]src[\\/]index\.(js|ts)$/},()=>({contents:'export default class Module { async onload(){} onLayoutReady(){} async onDataChanged(){} onunload(){} }',loader:'js'}));b.onLoad({filter:/shared[\\/]storage-migration\.ts$/},()=>({contents:'export async function migrateModules(){}',loader:'js'}));}}]});
  const mod={exports:{} as any};const errors:unknown[]=[];
  const win=dom.window;
  runInNewContext(output.outputFiles[0].text,{module:mod,exports:mod.exports,document:doc,window:win,
    Element:win.Element,HTMLElement:win.HTMLElement,AbortController:win.AbortController,MutationObserver:win.MutationObserver,
    fetch:async(url:string,init:any)=>({ok:true,status:200,json:async()=>url.endsWith('getFile')?{from:'yzc-INL-plus',to:'yzc-INL',completed:true}:{code:0,data:JSON.parse(init.body).path==='/data/storage/petal'?[{name:'yzc-INL',isDir:true}]:[{name:'identity-migration-v1.json',isDir:false}]}}),
    ResizeObserver:class{observe(){}unobserve(){}disconnect(){}},requestAnimationFrame:win.requestAnimationFrame.bind(win),cancelAnimationFrame:win.cancelAnimationFrame.bind(win),setTimeout,clearTimeout,console,
    require:()=>({Plugin,fetchSyncPost:async()=>({code:0,data:[]}),showMessage:(error:unknown)=>errors.push(error),getAllEditor:()=>[],getAllTabs:()=>[],getActiveEditor:()=>undefined,getActiveTab:()=>undefined})});
  const plugin=new mod.exports.default();await plugin.onload();plugin.onLayoutReady();await flush();
  assert.equal(doc.querySelectorAll('.yzc-topbar').length,1);assert.equal(doc.querySelectorAll('.yzc-outline-list').length,1);assert.equal(doc.querySelectorAll('.yzc-windows').length,1);
  const launcher=doc.querySelector('.yzc-topbar');
  doc.documentElement.dataset.lightTheme='third-party';doc.querySelector('link')!.setAttribute('href','/appearance/themes/third-party/theme.css');await flush();
  assert.equal(doc.querySelector('.yzc-topbar'),launcher);assert.equal(doc.querySelectorAll('.yzc-windows').length,1);
  assert.equal(css.isConnected,true,'enabled plugin owns its visuals independently of host theme');
  assert.equal(writes,1,'theme changes must not recreate or resave window state');
  plugin.onunload();await flush();assert.equal(doc.querySelectorAll('[class*="yzc-"]').length,0);
  assert.equal(doc.querySelector('#yzc-launcher-style'),null);assert.equal(doc.documentElement.hasAttribute('data-yzc-plugin'),false);
  for(const name of [...doc.documentElement.attributes].map(a=>a.name))assert.equal(/^data-(sv-|style$|typography$|inl$|colored-|yzc-plugin)/.test(name),false,name);
  assert.equal(css.isConnected,false);
  assert.equal([...listeners.values()].reduce((n,set)=>n+set.size,0),0);
  assert.equal(doc.documentElement.style.getPropertyValue('--sv-sidebar-edge'),'');
  assert.equal(doc.querySelector('.native')!.textContent,'Native headings');
  doc.head.append(css);
  const reloaded=new mod.exports.default();await reloaded.onload();reloaded.onLayoutReady();await flush();
  assert.equal(writes,1,'data-change plugin reload must not write the same state again');
  win.dispatchEvent(new win.Event('pagehide'));await flush();
  assert.equal(doc.querySelectorAll('[class*="yzc-"]').length,0);
  assert.equal(doc.querySelector('#yzc-launcher-style'),null);
  reloaded.onunload();assert.deepEqual(errors,[]);dom.window.close();
});
