import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {WindowModel} from '../plugin/src/windows/window-model';
import {WindowAdapter} from '../plugin/src/adapters/window-adapter';
import type {HostDocument,WindowHost} from '../plugin/src/adapters/window-host';

const a={id:'a',title:'视觉文案'}, b={id:'b',title:'测试22'};
test('ordinary browsing replaces one window; only + creates a new slot; history is deduplicated',()=>{
  const model=new WindowModel(null,a);
  for(let i=0;i<10;i++)model.visit(b);
  assert.equal(model.state.slots.length,1);assert.deepEqual(model.active.document,b);assert.equal(model.state.recent.length,1);
  model.add('explicit');assert.equal(model.active.document,undefined);model.visit(a);
  assert.equal(model.state.slots.length,2);assert.deepEqual(model.state.slots[0].document,b);
  model.select('initial');model.visit(a);assert.equal(model.state.slots.length,2);
  model.move('explicit','initial');assert.equal(model.state.slots[0].key,'explicit');
  const restored=new WindowModel(JSON.parse(JSON.stringify(model.state)));
  assert.deepEqual(restored.state,model.state);model.close('initial');model.close('explicit');assert.equal(model.state.slots.length,1);
});

function setup() {
  const dom=new JSDOM('<div id="toolbar"><div id="drag"></div><button class="yzc-topbar">N</button></div><div class="layout__center"><div data-type="wnd" class="layout__wnd--active"><div class="fn__flex"><ul class="layout-tab-bar"></ul><ul class="layout-tab-bar layout-tab-bar--readonly"></ul></div><div class="layout-tab-container"><div class="protyle">Native editor</div></div></div></div><div class="file-tree"><li data-type="navigation-file" data-node-id="b"><span class="b3-list-item__toggle">expand</span><span class="b3-list-item__text">测试22</span></li></div>',{pretendToBeVisual:true});
  let active:HostDocument={...a,token:'one'};let docs=[active,{id:'old',title:'旧浏览文档',token:'old'}];let changed=()=>{};
  const opened:string[]=[],closed:string[]=[],saved:any[]=[];
  let hold:((doc:HostDocument)=>void)|undefined;
  const host:WindowHost={active:()=>active,documents:()=>docs,foreign:()=>false,
    open:async id=>{opened.push(id);const next={id,title:id==='b'?'测试22':'视觉文案',token:`new-${opened.length}`};active=next;docs.push(next);changed();if(hold)await new Promise<HostDocument>(done=>hold=done);return next;},
    close:doc=>{closed.push(doc.token);docs=docs.filter(d=>d.token!==doc.token);changed();},subscribe:cb=>{changed=cb;return()=>{changed=()=>{};};}};
  const adapter=new WindowAdapter(host,null,s=>saved.push(s),e=>{throw e;},dom.window.document);
  dom.window.document.querySelector('.b3-list-item__text')!.addEventListener('click',()=>void host.open('b'));
  return{dom,doc:dom.window.document,adapter,opened,closed,saved,changed:()=>changed(),setHold:()=>{hold=()=>{};},release:()=>hold?.(active)};
}
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

test('pointer reorder preserves active editor and keyed DOM; Escape cancels sorting',()=>{
  const {dom,doc,adapter,opened}=setup();
  (doc.querySelector('.yzc-window-add') as HTMLElement).click();
  const items=[...doc.querySelectorAll<HTMLElement>('.yzc-window')];
  const strip=doc.querySelector<HTMLElement>('.yzc-window-strip')!;
  let captured=false;
  strip.setPointerCapture=()=>{captured=true;};strip.hasPointerCapture=()=>captured;strip.releasePointerCapture=()=>{captured=false;};
  doc.elementFromPoint=()=>items[0];
  const pointer=(type:string,x:number)=>{
    const event=new dom.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,buttons:1,clientX:x,clientY:10});
    Object.defineProperty(event,'pointerId',{value:1});items[1].querySelector('button')!.dispatchEvent(event);
  };
  const active=adapter.model.state.active;
  pointer('pointerdown',200);pointer('pointermove',30);pointer('pointerup',30);
  assert.equal(strip.firstElementChild,items[1]);assert.equal(adapter.model.state.active,active);assert.equal(opened.length,0);
  assert.equal(captured,false);
  doc.elementFromPoint=()=>items[0];pointer('pointerdown',30);pointer('pointermove',200);
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape'}));pointer('pointerup',200);
  assert.equal(strip.firstElementChild,items[1]);assert.equal(captured,false);
  adapter.dispose();dom.window.close();
});

test('tree click, recent item and + follow the explicit-window contract; closing cleans all DOM and listeners',async()=>{
  const {dom,doc,adapter,opened,closed}=setup();
  assert.deepEqual(closed,['old']);
  (doc.querySelector('.b3-list-item__text') as HTMLElement).click();await flush();
  assert.deepEqual(opened,['b']);assert.equal(doc.querySelectorAll('[role="tab"]').length,1);assert.equal(doc.querySelector('[role="tab"]')!.textContent,'测试22');
  (doc.querySelector('.yzc-window-add') as HTMLElement).click();
  assert.equal(doc.querySelectorAll('[role="tab"]').length,2);assert.equal(doc.querySelectorAll('.yzc-window-empty').length,1);assert.deepEqual(opened,['b'],'+ must not create a real note');
  (doc.querySelector('.yzc-window-recent') as HTMLElement).click();
  const recent=[...doc.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(e=>e.textContent==='视觉文案')!;recent.click();await flush();
  assert.equal(doc.querySelectorAll('[role="tab"]').length,2);assert.deepEqual(adapter.model.active.document,a);assert.equal(doc.querySelectorAll('.yzc-window-empty').length,0);
  (doc.querySelector('.yzc-window-recent') as HTMLElement).click();adapter.dispose();
  assert.equal(doc.querySelectorAll('.yzc-windows,.yzc-window-history,.yzc-window-empty,[data-yzc-window-bar],[data-yzc-window-empty]').length,0);
  (doc.querySelector('.b3-list-item__text') as HTMLElement).click();await flush();assert.equal(opened.length,3,'native tree remains usable after cleanup');assert.equal(doc.querySelector('.protyle')!.textContent,'Native editor');dom.window.close();
});

test('expansion clicks do not navigate; a late native event does not fill a deliberately empty window',async()=>{
  const {dom,doc,adapter,opened,changed}=setup();
  (doc.querySelector('.b3-list-item__toggle') as HTMLElement).click();await flush();assert.equal(opened.length,0);
  (doc.querySelector('.yzc-window-add') as HTMLElement).click();changed();
  assert.equal(adapter.model.active.document,undefined);assert.equal(doc.querySelectorAll('.yzc-window-empty').length,1);
  adapter.dispose();dom.window.close();
});

test('in-flight navigation cannot remount controls after theme deactivation',async()=>{
  const {dom,doc,adapter,setHold,release}=setup();setHold();adapter.browse(b);await flush();adapter.dispose();release();await flush();
  assert.equal(doc.querySelectorAll('.yzc-windows,.yzc-window-empty').length,0);assert.equal(doc.querySelectorAll('[data-yzc-window-bar],[data-yzc-window-empty]').length,0);dom.window.close();
});

test('titlebar strip and keyed controls survive ten navigation commits and host row replacement',async()=>{
  const {dom,doc,adapter,changed}=setup();
  const nav=doc.querySelector('.yzc-windows'),tab=doc.querySelector('[role="tab"]'),add=doc.querySelector('.yzc-window-add'),recent=doc.querySelector('.yzc-window-recent');
  assert.equal(nav?.parentElement,doc.querySelector('#toolbar'));
  assert.equal(nav?.nextElementSibling,doc.querySelector('#drag'));
  assert.ok(doc.querySelector('.layout__wnd--active')?.firstElementChild?.querySelector('.layout-tab-bar'));
  assert.equal(doc.querySelector('.yzc-window-strip')?.nextElementSibling,add?.parentElement,'action group immediately follows explicit windows');
  assert.equal(add?.nextElementSibling,recent,'history immediately follows +');
  assert.equal(recent?.nextElementSibling,null,'no spacer splits or trails the action group');
  assert.equal(doc.querySelector('.layout__center .yzc-windows'),null);
  for(let i=0;i<10;i++){
    adapter.browse({id:i%2?'a':'b',title:i%2?'视觉文案':'测试22'});await flush();changed();
    assert.equal(doc.querySelector('.yzc-windows'),nav);assert.equal(doc.querySelector('[role="tab"]'),tab);
    assert.equal(doc.querySelector('.yzc-window-add'),add);assert.equal(doc.querySelector('.yzc-window-recent'),recent);
    assert.equal(doc.querySelectorAll('#toolbar .yzc-windows').length,1);
  }
  const row=doc.querySelector('.layout__wnd--active > .fn__flex')!;row.replaceWith(row.cloneNode(true));await flush();
  doc.querySelector('#drag')!.textContent='Native title update';await flush();
  assert.equal(doc.querySelector('.yzc-windows'),nav);assert.equal(doc.querySelectorAll('.yzc-windows').length,1);
  adapter.dispose();dom.window.close();
});
