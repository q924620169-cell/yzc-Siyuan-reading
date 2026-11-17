import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {WindowModel} from '../plugin/src/windows/window-model';
import {WindowAdapter} from '../plugin/src/adapters/window-adapter';
import type {WindowHost} from '../plugin/src/adapters/window-host';

test('tool opens left once, reopens at user order, survives persistence and never consumes a document slot',()=>{
  const model=new WindowModel({version:1,active:'a',slots:[{key:'a',document:{id:'doc-a',title:'A'}},{key:'b',document:{id:'doc-b',title:'B'}}]});
  model.openTool('rss','RSS');assert.equal(model.state.slots[0].tool?.id,'rss');assert.equal(model.active.tool?.id,'rss');
  model.move('a','tool:rss');model.openTool('rss','RSS');
  assert.deepEqual(model.state.slots.map(s=>s.key),['a','tool:rss','b']);
  const restored=new WindowModel(structuredClone(model.state));assert.deepEqual(restored.state,model.state);
  restored.visit({id:'doc-c',title:'C'});assert.equal(restored.state.slots[1].tool?.id,'rss');assert.equal(restored.active.document?.id,'doc-c');
  restored.close('tool:rss');assert.equal(restored.state.slots.length,2);
});
test('last tool can close to an empty document window',()=>{
  const m=new WindowModel(null);m.openTool('rss','RSS');m.close('initial');m.close('tool:rss');
  assert.equal(m.state.slots.length,1);assert.equal(m.active.tool,undefined);
});
test('registered tool keeps one titlebar, reselects, activates documents and cleans up',async()=>{
  const dom=new JSDOM('<div id="toolbar"><div id="drag"></div></div><div class="layout__center"><div data-type="wnd" class="layout__wnd--active"><div class="fn__flex"><ul class="layout-tab-bar"></ul></div><div class="layout-tab-container"></div></div></div>',{pretendToBeVisual:true});
  let isTool=false,reselect=0,closed=0;const visible:boolean[]=[];
  const host:WindowHost={active:()=>isTool?undefined:{id:'doc-a',title:'A',token:'a'},documents:()=>[],foreign:()=>isTool,
    open:async()=>{isTool=false;return{id:'doc-a',title:'A',token:'a'};},close:()=>{},subscribe:()=>()=>{}};
  const a=new WindowAdapter(host,null,()=>{},e=>{throw e;},dom.window.document);
  const unregister=a.registerTool({id:'rss',title:'RSS',isActive:()=>isTool,open:async()=>{isTool=true;},close:()=>{closed++;isTool=false;},active:value=>visible.push(value),reselect:()=>{reselect++;}});
  a.openTool('rss');for(let i=0;i<20;i++)await Promise.resolve();
  const nav=dom.window.document.querySelector<HTMLElement>('.yzc-windows')!;
  assert.equal(nav.hidden,false);assert.equal(nav.querySelectorAll('[role=tab]').length,2);
  (nav.querySelector('[role=tab]') as HTMLElement).click();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(reselect,1);
  a.browse({id:'doc-a',title:'A'});for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(a.model.state.slots.find(s=>s.tool)?.document,undefined);
  assert.equal(isTool,false);assert.ok(visible.includes(false));
  let hostToolbarClicks=0;
  dom.window.document.querySelector('#toolbar')!.addEventListener('click',()=>{hostToolbarClicks++;});
  (nav.querySelector('.yzc-window-close') as HTMLElement).click();
  assert.equal(hostToolbarClicks,0,'removed close target must never reach the host toolbar parent walker');
  assert.equal(closed,1);
  unregister();a.dispose();assert.equal(dom.window.document.querySelector('.yzc-windows'),null);dom.window.close();
});
