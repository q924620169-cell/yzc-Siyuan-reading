import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {FilteredNativeTree} from '../plugin/src/adapters/filtered-native-tree';
test('filtered close snapshots keep native animation identity and compact visible positions',()=>{
 const dom=new JSDOM('<div class="sy__file"><div data-tree-animation style="height:0px"><div style="position:absolute;top:0px;margin-bottom:2px;display:none"></div><div style="position:absolute;top:30px;margin-bottom:2px"></div><div style="position:absolute;top:60px;margin-bottom:2px"></div></div></div>');
 const doc=dom.window.document,branch=doc.querySelector('[data-tree-animation]') as HTMLElement;
 for(const row of branch.children)(row as HTMLElement).getBoundingClientRect=()=>({height:28}) as DOMRect;
 const original=[{height:'90px'},{height:'0px'}];let frames:any[]=original,writes=0;
 const effect={getKeyframes:()=>frames,setKeyframes:(next:any[])=>{frames=next;writes++;}},animation={playState:'running',effect,currentTime:35};
 (branch as any).getAnimations=()=>[animation];const native=new FilteredNativeTree(doc);native.sync();
 assert.deepEqual(frames.map(f=>f.height),['60px','0px']);assert.equal((branch.children[1] as HTMLElement).style.top,'0px');assert.equal((branch.children[2] as HTMLElement).style.top,'30px');
 assert.equal(animation.effect,effect);assert.equal(animation.currentTime,35);native.sync();assert.equal(writes,1);
 native.dispose();assert.equal(frames,original);assert.equal((branch.children[1] as HTMLElement).style.top,'30px');dom.window.close();
});
test('filtered open corrects inline end height without creating or reparenting nodes',()=>{
 const dom=new JSDOM('<div class="sy__file"><div data-tree-animation style="height:90px"><div></div><div hidden></div></div></div>'),doc=dom.window.document,branch=doc.querySelector('[data-tree-animation]') as HTMLElement;
 const row=branch.firstElementChild!;(row as HTMLElement).getBoundingClientRect=()=>({height:30}) as DOMRect;
 let frames:any[]=[{height:'0px'},{height:'90px'}];(branch as any).getAnimations=()=>[{playState:'running',effect:{getKeyframes:()=>frames,setKeyframes:(next:any[])=>frames=next}}];
 const native=new FilteredNativeTree(doc);native.sync();assert.equal(branch.style.height,'30px');assert.deepEqual(frames.map(f=>f.height),['0px','30px']);assert.equal(branch.firstElementChild,row);assert.equal(branch.children.length,2);native.dispose();assert.equal(branch.style.height,'90px');dom.window.close();
});
