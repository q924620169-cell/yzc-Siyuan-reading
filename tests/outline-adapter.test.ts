import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { OutlineAdapter, flattenOutline, type OutlineEditor, type OutlineNode } from '../plugin/src/adapters/outline-adapter';

test('full outline preserves hierarchy, empty host names fall back to content', () => {
  const nodes: OutlineNode[] = [{id:'a',name:'A&nbsp;&amp; B',nameIsHTML:true,blocks:[{id:'b',name:'',content:'Child <literal>',subType:'h3'}]}];
  assert.deepEqual(flattenOutline(nodes, text => text.replace('&nbsp;',' ').replace('&amp;','&')), [{id:'a',text:'A & B',depth:0},{id:'b',text:'Child <literal>',depth:1}]);
});

test('jump to an unloaded heading aligns it after the host loads the target', async () => {
  const {dom,doc,content,adapter,refresh}=setup(async()=>[{id:'a',name:'First'},{id:'b',name:'Later'}]);
  await flush();
  doc.querySelector<HTMLButtonElement>('.yzc-outline-list [data-heading-id="b"]')!.click();
  let scrolled=-1;content.scrollTo=options=>{scrolled=(options as ScrollToOptions).top!;};
  content.insertAdjacentHTML('beforeend','<div data-type="NodeHeading" data-node-id="b"></div>');
  content.querySelector<HTMLElement>('[data-node-id="b"]')!.getBoundingClientRect=()=>({top:156} as DOMRect);
  refresh();assert.equal(scrolled,132);
  adapter.dispose();dom.window.close();
});
function setup(load: (id:string) => Promise<OutlineNode[]>) {
  const dom = new JSDOM('<div class="sy__outline"><div class="block__icons">大纲</div><ul class="native">native headings</ul></div><div class="protyle"><div class="protyle-content"><div data-type="NodeHeading" data-node-id="a">A</div></div><div class="protyle-scroll"></div></div>', {pretendToBeVisual:true});
  for (const key of ['Element','HTMLElement','MutationObserver'] as const) Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
  const doc = dom.window.document;
  const element = doc.querySelector<HTMLElement>('.protyle')!, content=doc.querySelector<HTMLElement>('.protyle-content')!;
  let editors:OutlineEditor[] = [{id:'doc',element,content}];
  let refresh:(invalidate?:boolean)=>void = () => {};
  const jumps:string[]=[];
  const adapter = new OutlineAdapter({editors:()=>editors,active:()=>element,load,jump:id=>jumps.push(id),subscribe:fn=>{refresh=fn;return()=>{};}},doc);
  return {dom,doc,element,content,adapter,jumps,refresh:(dirty=false)=>refresh(dirty),setEditors:(next:OutlineEditor[])=>editors=next};
}
const flush = async () => { for(let i=0;i<6;i++) await Promise.resolve(); };

test('one right outline and one left outline share active location, full unloaded headings and cleanup', async () => {
  const {dom,doc,content,adapter,jumps,refresh} = setup(async()=>[{id:'a',name:'First'},{id:'b',name:'Not loaded yet'}]);
  await flush();
  for(let i=0;i<5;i++) refresh();
  assert.equal(doc.querySelectorAll('.yzc-scrollspy').length,1);
  assert.equal(doc.querySelectorAll('.yzc-outline-list').length,1);
  assert.equal(doc.querySelectorAll('.yzc-scrollspy button').length,2);
  assert.equal(doc.querySelectorAll('.yzc-scrollspy-ticks .yzc-heading-tick').length,2);
  assert.equal(doc.querySelector('.yzc-scrollspy')!.getAttribute('tabindex'),'0');
  assert.equal(doc.querySelector('.yzc-scrollspy [aria-current]')?.getAttribute('data-heading-id'),'a');
  assert.equal(doc.querySelector('.yzc-outline-list [aria-current]')?.getAttribute('data-heading-id'),'a');
  doc.querySelector<HTMLButtonElement>('.yzc-outline-list [data-heading-id="b"]')!.click();
  assert.deepEqual(jumps,['b']);
  let scrolled = -1; content.scrollTo = options => { scrolled=(options as ScrollToOptions).top!; };
  content.querySelector<HTMLElement>('[data-node-id="a"]')!.getBoundingClientRect=()=>({top:140} as DOMRect);
  doc.querySelector<HTMLButtonElement>('.yzc-scrollspy [data-heading-id="a"]')!.click();
  assert.equal(scrolled,116);
  adapter.dispose();
  assert.equal(doc.querySelectorAll('.yzc-scrollspy,.yzc-outline-list,.yzc-has-outline,.yzc-outline-panel').length,0);
  assert.equal(doc.querySelector('.native')!.textContent,'native headings');
  dom.window.close();
});

test('scroll updates both surfaces; edits refresh heading text without duplicate views', async () => {
  let name='Second';
  const {dom,doc,content,adapter,refresh}=setup(async()=>[{id:'a',name:'First'},{id:'b',name}]);
  await flush();
  content.insertAdjacentHTML('beforeend','<div data-type="NodeHeading" data-node-id="b"></div>');
  content.querySelector<HTMLElement>('[data-node-id="a"]')!.getBoundingClientRect=()=>({top:-100} as DOMRect);
  content.querySelector<HTMLElement>('[data-node-id="b"]')!.getBoundingClientRect=()=>({top:24} as DOMRect);
  refresh();
  assert.equal(doc.querySelector('.yzc-outline-list [aria-current]')?.getAttribute('data-heading-id'),'b');
  assert.equal(doc.querySelector('.yzc-scrollspy [aria-current]')?.getAttribute('data-heading-id'),'b');
  assert.equal(doc.querySelector('.yzc-heading-tick--current')?.getAttribute('data-tick-id'),'b');
  assert.equal(doc.querySelectorAll('.yzc-heading-tick--current').length,1);
  name='Renamed'; refresh(true); await flush();
  assert.equal(doc.querySelector('.yzc-scrollspy [data-heading-id="b"]')!.textContent,'Renamed');
  assert.equal(doc.querySelectorAll('.yzc-scrollspy').length,1);
  adapter.dispose();dom.window.close();
});

test('an old outline response cannot revive a closed editor or overwrite a new document', async () => {
  let resolve!:(value:OutlineNode[])=>void;
  const delayed=new Promise<OutlineNode[]>(done=>resolve=done);
  const {dom,doc,element,content,adapter,setEditors,refresh}=setup(id=>id==='doc'?delayed:Promise.resolve([{id:'new',name:'New document'}]));
  setEditors([{id:'other',element,content}]);refresh();await flush();
  resolve([{id:'old',name:'Old document'}]);await flush();
  assert.equal(doc.querySelector('.yzc-scrollspy')!.textContent,'New document');
  setEditors([]);refresh();
  assert.equal(doc.querySelectorAll('.yzc-scrollspy').length,0);
  adapter.dispose();dom.window.close();
});
