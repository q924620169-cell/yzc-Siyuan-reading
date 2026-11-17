import test from'node:test';import assert from'node:assert/strict';import{JSDOM}from'jsdom';
import{NativeTreeExpansion}from'../plugin/src/adapters/native-tree-expansion';
const keys=['notebook:box','notebook:box/parent','notebook:other'];
function fixture(){
 const dom=new JSDOM('<div class="sy__file"><ul role="tree"></ul></div>'),doc=dom.window.document,rows:HTMLElement[]=[],saved:Record<string,boolean>[]=[],clicks:string[]=[];
 for(const[key,index]of keys.map((key,index)=>[key,index]as const)){const row=doc.createElement('li');row.dataset.treeKey=key;row.setAttribute('aria-expanded',String(index<2));const toggle=doc.createElement('span');toggle.className='b3-list-item__toggle';toggle.onclick=()=>{clicks.push(key);row.setAttribute('aria-expanded',String(row.getAttribute('aria-expanded')!=='true'));};row.append(toggle);doc.querySelector('ul')!.append(row);rows.push(row);}
 const expansion=new NativeTreeExpansion(doc,state=>saved.push(state));return{dom,doc,rows,saved,clicks,expansion,open:()=>rows.map(row=>row.getAttribute('aria-expanded')==='true'),close(){expansion.dispose();dom.window.close();}};
}
test('Library and Inbox enter collapsed; Now restores its previous native expanded rows',()=>{
 const f=fixture();f.expansion.captureNow();f.expansion.enter('library');assert.deepEqual(f.open(),[false,false,false]);
 f.expansion.enter('inbox');assert.deepEqual(f.open(),[false,false,false]);f.expansion.enter('now');assert.deepEqual(f.open(),[true,true,false]);
 assert.equal(f.rows.length,3);assert.ok(f.saved[0][keys[0]]&&f.saved[0][keys[1]]);f.close();
});
test('manual native expansion is allowed in a collapsed view and the next entry collapses it again',()=>{
 const f=fixture();f.expansion.captureNow();f.expansion.enter('library');f.rows[0].dispatchEvent(new f.dom.window.MouseEvent('pointerdown',{bubbles:true}));(f.rows[0].firstElementChild as HTMLElement).click();f.expansion.sync('library');assert.equal(f.open()[0],true);
 f.expansion.enter('library');assert.deepEqual(f.open(),[false,false,false]);f.expansion.enter('now');assert.deepEqual(f.open(),[true,true,false]);f.close();
});
test('saved Now expansion survives startup while rapid view changes cannot overwrite it',()=>{
 const f=fixture();f.expansion.captureNow();const snapshot=f.saved[0];f.expansion.enter('inbox');f.expansion.enter('now');f.expansion.captureNow();f.expansion.enter('library');
 const restored=new NativeTreeExpansion(f.doc,()=>{});restored.load(snapshot);restored.enter('now');assert.deepEqual(f.open(),[true,true,false]);restored.dispose();f.close();
});
test('a first Now view leaves the host expansion untouched',()=>{const f=fixture();f.expansion.enter('now');assert.deepEqual(f.open(),[true,true,false]);assert.equal(f.clicks.length,0);f.close();});
