import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {JSDOM} from 'jsdom';

const A='20261114000000-aaaaaaa',B='20261114000000-bbbbbbb',HOME='20261114000000-homeabc';
const settle=()=>new Promise(r=>setTimeout(r,30));
const compiled=buildSync({entryPoints:['plugin/src/adapters/document-navigation.ts'],bundle:true,platform:'node',format:'cjs',external:['siyuan'],write:false}).outputFiles[0].text;
function fixture(config:Record<string,unknown>={}) {
 const dom=new JSDOM(`<div class="sy__file"><div class="file-tree__items"><ul><li data-type="navigation-root" data-tree-key="notebook:box" aria-expanded="true"></li><li data-type="navigation-file" data-node-id="${A}" data-tree-key="notebook:box/${A}"><span data-type="new" class="b3-list-item__action">+</span></li><li data-type="navigation-file" data-node-id="${B}" data-tree-key="notebook:box/${A}/${B}"></li></ul></div></div>`);
 const attrs=new Map<string,Record<string,string>>([[A,{id:A,type:'doc',tags:'资料库,未分类,工作','custom-inl-status':'now'}],[B,{id:B,type:'doc',tags:'个人','custom-inl-status':'library'}]]);
 const docs=[{id:A,box:'box',path:`/${A}.sy`,content:'parent'},{id:B,box:'box',path:`/${A}/${B}.sy`,content:'child'}];
 const data=new Map<string,any>([['document-navigation.json',config]]),events=new Map<string,Function>(),requests:any[]=[],opens:string[]=[];
 const plugin={loadData:async(k:string)=>data.get(k),saveData:async(k:string,v:unknown)=>{requests.push({save:k});data.set(k,JSON.parse(JSON.stringify(v)));},eventBus:{on:(k:string,f:Function)=>events.set(k,f),off:(k:string)=>events.delete(k)},app:{}};
 const request=async(path:string,body:any)=>{requests.push({path,body});let result:any;
  if(path.endsWith('/sql'))result=docs.filter(d=>!body.stmt.includes('AND id IN')||body.stmt.includes(d.id));
  else if(path.endsWith('getBlockAttrs'))result={...attrs.get(body.id)};
  else if(path.endsWith('setBlockAttrs')){attrs.set(body.id,{...attrs.get(body.id),...body.attrs});result=null;}
  else if(path.endsWith('lsNotebooks'))result={notebooks:[{id:'box',closed:false}]};
  else if(path.endsWith('getIDsByHPath'))result=[];
  else if(path.endsWith('createDocWithMd')){attrs.set(HOME,{id:HOME,type:'doc'});result=HOME;}
  return{code:0,data:result};
 };
 const mod={exports:{} as any};runInNewContext(compiled,{module:mod,exports:mod.exports,document:dom.window.document,setTimeout,clearTimeout,Date,require:()=>({fetchSyncPost:request,openTab:({doc}:any)=>opens.push(doc.id)})});
 const errors:any[]=[];const nav=new mod.exports.DocumentNavigation(plugin,()=>{},(e:any)=>errors.push(e),dom.window.document);
 const click=(category:string)=>(dom.window.document.querySelector(`[data-category=${category}]`)as HTMLElement).click();
 const hidden=(id:string)=>dom.window.document.querySelector(`[data-node-id="${id}"]`)!.hasAttribute('data-yzc-class-hidden');
 const close=()=>{nav.dispose();assert.deepEqual(errors,[]);assert.equal(events.size,0);dom.window.close();};
 return{dom,attrs,docs,data,events,requests,opens,nav,errors,click,hidden,close};
}
test('default is Now; all statuses reuse native rows and retain required ancestor paths',async()=>{
 const f=fixture({selected:'library'});await settle();const tree=f.dom.window.document.querySelector('.file-tree__items');
 assert.equal(f.dom.window.document.querySelector('.yzc-document-title'),null);
 assert.equal(f.dom.window.document.querySelector('[data-category=now]')!.getAttribute('aria-current'),'page');
 assert.equal(f.dom.window.document.querySelector('[data-category=now]')!.textContent,'我的文档');
 assert.equal(f.dom.window.document.querySelectorAll('.yzc-document-back').length,0);
 assert.equal(f.dom.window.document.querySelector('[data-category=now]')!.hasAttribute('data-filtered'),false);
 assert.equal(f.hidden(A),false);assert.equal(f.hidden(B),true);
 f.click('library');await settle();assert.equal(f.hidden(A),false);assert.equal(f.hidden(B),false);
 const back=f.dom.window.document.querySelector('[data-category=now]') as HTMLElement;assert.equal(back.hasAttribute('data-filtered'),true);back.click();await settle();assert.equal(f.hidden(B),true);assert.equal(back.hasAttribute('data-filtered'),false);
 f.click('inbox');await settle();assert.equal(f.hidden(A),true);assert.equal(f.hidden(B),true);
 f.click('now');await settle();assert.equal(f.hidden(A),false);assert.equal(f.hidden(B),true);
 f.click('library');f.click('inbox');f.click('now');await settle();
 assert.equal(f.dom.window.document.querySelector('[data-category=now]')!.getAttribute('aria-current'),'page');
 assert.equal(f.dom.window.document.querySelectorAll('.yzc-document-nav').length,1);
 assert.equal(f.dom.window.document.querySelector('.file-tree__items'),tree);assert.equal(f.opens.length,0);f.close();
});
test('document menu changes only root internal status, preserves tags/roles/paths and keeps editor open',async()=>{
 const f=fixture();await settle();const menu:any[]=[];
 f.events.get('open-menu-doctree')!({detail:{type:'doc',items:[{id:B}],menu:{addItem:(item:any)=>menu.push(item)}}});
 assert.equal(menu[0].label,'INL 状态');menu[0].submenu.find((s:any)=>s.label==='Now').click();await settle();
 assert.equal(f.attrs.get(B)!['custom-inl-status'],'now');assert.equal(f.attrs.get(B)!.tags,'个人');
 assert.equal(f.docs[1].path,`/${A}/${B}.sy`);assert.equal(f.hidden(B),false);assert.equal(f.opens.length,0);
 const write=f.requests.find(r=>r.path?.endsWith('setBlockAttrs'));assert.deepEqual(Object.keys(write.body.attrs),['custom-inl-status']);
 assert.ok(f.requests.findIndex(r=>r.save==='inl-status-backup.json')<f.requests.indexOf(write));f.close();
});
test('native content tag changes cannot change a document status or clean user tags',async()=>{
 const f=fixture();await settle();f.attrs.get(A)!.tags='未分类,资料库,复盘';
 f.events.get('ws-main')!({detail:{cmd:'setBlockAttrs',data:{id:A}}});await new Promise(r=>setTimeout(r,230));
 assert.equal(f.attrs.get(A)!.tags,'未分类,资料库,复盘');assert.equal(f.hidden(A),false);
 assert.equal(f.requests.filter(r=>r.path?.endsWith('setBlockAttrs')).length,0);f.close();
});
test('ordinary creation defaults to Inbox while tree creation uses the clicked view, not the later view',async()=>{
 const f=fixture();await settle();f.click('library');await settle();
 f.attrs.set(B,{id:B,type:'doc',tags:'工作'});
 f.events.get('ws-main')!({detail:{cmd:'create',data:{id:B,box:'box',path:`/${A}/${B}.sy`}}});await settle();
 assert.equal(f.attrs.get(B)!['custom-inl-status'],'inbox');
 (f.dom.window.document.querySelector('[data-type=new]') as HTMLElement).click();f.click('now');
 f.attrs.set(B,{id:B,type:'doc',tags:'工作','custom-inl-status':'inbox'});f.docs.splice(1,1);
 f.events.get('ws-main')!({detail:{cmd:'create',data:{id:B,box:'box',path:`/${A}/${B}.sy`}}});await settle();
 assert.equal(f.attrs.get(B)!['custom-inl-status'],'library');assert.equal(f.attrs.get(B)!.tags,'工作');
 f.click('library');await settle();assert.equal(f.hidden(B),false,'native creation metadata remains usable before SQL indexing');f.close();
});
test('cancelled tree creation does not contaminate a later ordinary creation; configurable default works',async()=>{
 const f=fixture({defaultStatus:'library'});await settle();
 (f.dom.window.document.querySelector('[data-type=new]') as HTMLElement).click();
 f.dom.window.document.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
 f.attrs.set(B,{id:B,type:'doc'});
 f.events.get('ws-main')!({detail:{cmd:'create',data:{id:B,box:'box',path:`/${A}/${B}.sy`}}});await settle();
 assert.equal(f.attrs.get(B)!['custom-inl-status'],'library');f.close();
});
test('home stays one native document and does not turn the filtered tree into an all-documents view',async()=>{
 const f=fixture();await settle();f.click('home');f.click('home');await settle();
 assert.deepEqual(f.opens,[HOME]);assert.equal(f.requests.filter(r=>r.path?.endsWith('createDocWithMd')).length,1);
 assert.equal(f.hidden(B),true);f.dom.window.document.dispatchEvent(new f.dom.window.CustomEvent('yzc-inl:document-space'));await settle();
 assert.equal(f.dom.window.document.querySelector('[data-category=now]')!.getAttribute('aria-current'),'page');f.close();
});
test('native above/below creation inherits the view with the sibling parent, not the clicked document',async()=>{
 const f=fixture();await settle();f.click('library');await settle();
 const row=f.dom.window.document.querySelector(`[data-node-id="${A}"]`)!;
 f.events.get('open-menu-doctree')!({detail:{type:'doc',items:[{id:A,path:`/${A}.sy`,notebookId:'box'}],elements:[row],menu:{addItem(){}}}});
 f.dom.window.document.body.insertAdjacentHTML('beforeend','<div id="commonMenu"><button class="b3-menu__item"><span class="b3-menu__label">在下方新建文档</span></button></div>');
 (f.dom.window.document.querySelector('.b3-menu__item') as HTMLElement).click();
 f.attrs.set(B,{id:B,type:'doc','custom-inl-status':'inbox'});
 f.events.get('ws-main')!({detail:{cmd:'create',data:{id:B,box:'box',path:`/${B}.sy`}}});await settle();
 assert.equal(f.attrs.get(B)!['custom-inl-status'],'library');f.close();
});
test('view selection is immediate; superseded Home work cannot open a late document',async()=>{
 const f=fixture();await settle();f.click('library');
 assert.equal(f.dom.window.document.querySelector('[data-category=library]')!.getAttribute('aria-current'),'page');
 f.click('home');f.click('inbox');assert.equal(f.dom.window.document.querySelector('[data-category=inbox]')!.getAttribute('aria-current'),'page');
 await settle();assert.equal(f.opens.length,0);assert.equal(f.requests.filter(r=>r.path?.endsWith('createDocWithMd')).length,0);f.close();
});
