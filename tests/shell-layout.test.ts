import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {ShellLayoutAdapter} from '../plugin/src/adapters/shell-layout-adapter';

test('shell boundary follows resize/collapse and removes geometry on unload', () => {
  const dom=new JSDOM('<div id="dockLeft"></div><div id="layouts"><div class="layout__center"></div></div>');
  dom.window.document.querySelector('#dockLeft')!.getBoundingClientRect=()=>({right:42} as DOMRect);
  let notify!:()=>void;
  let disconnected=false;
  Object.defineProperty(globalThis,'ResizeObserver',{configurable:true,value:class {
    constructor(cb:()=>void){notify=cb;} observe(){} unobserve(){} disconnect(){disconnected=true;}
  }});
  Object.defineProperty(globalThis,'MutationObserver',{configurable:true,value:dom.window.MutationObserver});
  Object.defineProperty(globalThis,'cancelAnimationFrame',{configurable:true,value:()=>{}});
  let edge=338;
  dom.window.document.querySelector('.layout__center')!.getBoundingClientRect=()=>({left:edge} as DOMRect);
  const adapter=new ShellLayoutAdapter(dom.window.document);
  const style=dom.window.document.documentElement.style;
  assert.equal(style.getPropertyValue('--sv-sidebar-edge'),'338px');
  assert.equal(dom.window.document.documentElement.dataset.svSidebarCollapsed,'false');
  edge=422;notify();assert.equal(style.getPropertyValue('--sv-sidebar-edge'),'422px');
  edge=42;notify();assert.equal(style.getPropertyValue('--sv-sidebar-edge'),'42px');
  assert.equal(dom.window.document.documentElement.dataset.svSidebarCollapsed,'true');
  edge=0;notify();assert.equal(style.getPropertyValue('--sv-sidebar-edge'),'0px');
  adapter.dispose();assert.equal(style.getPropertyValue('--sv-sidebar-edge'),'');assert.equal(disconnected,true);
  assert.equal(dom.window.document.documentElement.hasAttribute('data-sv-sidebar-collapsed'),false);
  dom.window.close();
});

test('gutter measures the actual pane and content edges, keeping wide panes unchanged and restoring inline variables',()=>{
  const dom=new JSDOM('<div class="layout__center"><div class="protyle yzc-has-outline" style="--yzc-editor-width:123px"><div class="protyle-wysiwyg"></div></div></div>');
  let notify!:()=>void;
  Object.defineProperty(globalThis,'ResizeObserver',{configurable:true,value:class {constructor(fn:()=>void){notify=fn;}observe(){}unobserve(){}disconnect(){}}});
  Object.defineProperty(globalThis,'MutationObserver',{configurable:true,value:dom.window.MutationObserver});
  Object.defineProperty(globalThis,'cancelAnimationFrame',{configurable:true,value:()=>{}});
  const doc=dom.window.document,pane=doc.querySelector<HTMLElement>('.protyle')!,content=doc.querySelector('.protyle-wysiwyg')!;
  let width=1200,gap=100;
  pane.getBoundingClientRect=()=>({left:300,right:300+width,width} as DOMRect);
  content.getBoundingClientRect=()=>({left:300,right:300+width-gap} as DOMRect);
  const adapter=new ShellLayoutAdapter(doc);
  assert.equal(pane.style.getPropertyValue('--yzc-right-utility-gutter'),'0px');
  width=500;gap=12;notify();assert.equal(pane.style.getPropertyValue('--yzc-editor-width'),'500px');
  assert.equal(pane.style.getPropertyValue('--yzc-right-utility-gutter'),'40px');
  width=1200;gap=100;notify();assert.equal(pane.style.getPropertyValue('--yzc-right-utility-gutter'),'0px');
  adapter.dispose();assert.equal(pane.style.getPropertyValue('--yzc-editor-width'),'123px');assert.equal(pane.style.getPropertyValue('--yzc-right-utility-gutter'),'');dom.window.close();
});

test('floating footer reserves scroll-end space only in panes reaching the counters, and restores it on unload',()=>{
  const dom=new JSDOM('<div class="layout__center"><div class="protyle"></div></div><div id="status"></div>');
  let notify!:()=>void;
  Object.defineProperty(globalThis,'ResizeObserver',{configurable:true,value:class{constructor(fn:()=>void){notify=fn;}observe(){}unobserve(){}disconnect(){}}});
  Object.defineProperty(globalThis,'MutationObserver',{configurable:true,value:dom.window.MutationObserver});
  Object.defineProperty(globalThis,'cancelAnimationFrame',{configurable:true,value:()=>{}});
  const doc=dom.window.document,pane=doc.querySelector<HTMLElement>('.protyle')!;let bottom=900;
  pane.getBoundingClientRect=()=>({bottom,width:600,right:600} as DOMRect);
  doc.querySelector('#status')!.getBoundingClientRect=()=>({top:868,height:32} as DOMRect);
  const adapter=new ShellLayoutAdapter(doc);assert.equal(pane.style.getPropertyValue('--yzc-bottom-safe-area'),'36px');
  bottom=450;notify();assert.equal(pane.style.getPropertyValue('--yzc-bottom-safe-area'),'0px','upper split pane has no floating-footer collision');
  adapter.dispose();assert.equal(pane.style.getPropertyValue('--yzc-bottom-safe-area'),'');dom.window.close();
});
