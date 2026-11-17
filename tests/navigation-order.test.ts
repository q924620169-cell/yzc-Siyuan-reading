import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {NavigationPreferences,normalizeOrder} from '../plugin/src/navigation-order';
const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
test('order preferences recover missing, duplicate and foreign IDs without losing a valid order',()=>{
  assert.deepEqual(normalizeOrder({spaces:['yzc-RSS','bad','yzc-RSS'],shortcuts:['inbox','home']}),{version:1,spaces:['yzc-RSS','document','yzc-Reader'],shortcuts:['inbox','home','library']});
  assert.deepEqual(normalizeOrder(null).spaces,['document','yzc-Reader','yzc-RSS']);
});
test('rapid edits persist both groups in order and reject stale save echoes while pending',async()=>{
  const saved:any[]=[],errors:unknown[]=[];let release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  const prefs=new NavigationPreferences(null,async state=>{await gate;saved.push(state);},e=>errors.push(e));
  prefs.move('spaces','yzc-RSS','document');prefs.step('shortcuts','inbox',-1);prefs.replace(null);
  assert.equal(prefs.order('spaces')[0],'yzc-RSS');release();await settle();
  const restored=new NavigationPreferences(saved.at(-1),async()=>{},e=>errors.push(e));
  assert.deepEqual(restored.order('spaces'),['yzc-RSS','document','yzc-Reader']);
  assert.deepEqual(restored.order('shortcuts'),['home','inbox','library']);
  assert.equal(saved.length,2);assert.deepEqual(errors,[]);prefs.dispose();restored.dispose();
});
test('drag preview changes the live order without saving; release saves once and cancel restores',async()=>{
 const saves:any[]=[];const prefs=new NavigationPreferences(null,async state=>{saves.push(state);},error=>assert.fail(String(error)));
 assert.equal(prefs.beginPreview('spaces'),true);assert.equal(prefs.beginPreview('shortcuts'),false);
 prefs.previewMove('spaces','yzc-RSS','document');prefs.previewMove('spaces','yzc-Reader','yzc-RSS');prefs.replace(null);
 assert.deepEqual(prefs.order('spaces'),['yzc-Reader','yzc-RSS','document']);await settle();assert.equal(saves.length,0);
 prefs.finishPreview('spaces',false);assert.deepEqual(prefs.order('spaces'),['document','yzc-Reader','yzc-RSS']);await settle();assert.equal(saves.length,0);
 assert.equal(prefs.beginPreview('shortcuts'),true);prefs.previewMove('shortcuts','inbox','home');prefs.finishPreview('shortcuts',true);await settle();
 assert.equal(saves.length,1);assert.deepEqual(saves[0].shortcuts,['inbox','home','library']);assert.deepEqual(saves[0].spaces,['document','yzc-Reader','yzc-RSS']);prefs.dispose();
});
test('keyboard, menu and native drop use the same order and keep original button nodes',async()=>{
  const dom=new JSDOM('<nav></nav>'),doc=dom.window.document,saved:any[]=[],menus:any[]=[];
  const prefs=new NavigationPreferences(null,async state=>{saved.push(state);},error=>assert.fail(String(error)));
  const compiled=buildSync({entryPoints:['plugin/src/adapters/navigation-reorder.ts'],bundle:true,platform:'node',format:'cjs',external:['siyuan'],write:false}).outputFiles[0].text;
  const module={exports:{} as any};runInNewContext(compiled,{module,exports:module.exports,require:()=>({Menu:class{items:any[]=[];addItem(item:any){this.items.push(item);}open(){menus.push(this.items);}}})});
  const parent=doc.querySelector('nav')!,nodes=new Map<string,HTMLButtonElement>();
  for(const id of prefs.order('shortcuts')){const b=doc.createElement('button');nodes.set(id,b);parent.append(b);module.exports.reorderable(b,id,'shortcuts',prefs);}
  prefs.subscribe(()=>prefs.order('shortcuts').forEach((id,index)=>{const b=nodes.get(id)!;if(parent.children[index]!==b)parent.insertBefore(b,parent.children[index]??null);}));
  nodes.get('inbox')!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowUp',altKey:true,bubbles:true}));
  assert.equal(parent.children[1],nodes.get('inbox'));
  nodes.get('inbox')!.dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true}));menus[0][0].click();
  assert.equal(parent.children[0],nodes.get('inbox'));
  const drop=new dom.window.Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:{getData:()=>JSON.stringify({group:'shortcuts',id:'inbox'})}});nodes.get('library')!.dispatchEvent(drop);
  assert.deepEqual([...parent.children].map(n=>(n as HTMLElement).dataset.orderId),['home','library','inbox']);
  assert.equal(parent.lastChild,nodes.get('inbox'));await settle();assert.equal(saved.length,3);dom.window.close();
});
