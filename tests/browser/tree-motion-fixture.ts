import {DocumentTreeAdapter} from '../../plugin/src/adapters/document-tree-adapter';
import {projectTree} from '../../plugin/src/inl/inl-tree';
import {TreeMotion} from '../../plugin/src/adapters/tree-motion';

// Isolated host fixture: same adjacent LI/UL contract and WAAPI completion
// behavior as SiYuan 3.8.6 module 60675, without accessing user notes or windows.
const children:Record<string,string[]>={book:['n1','n2','n3','n4','n5','n6','l1','l2','folder'],sibling:['sn','sl'],normal:['x','y','z'],folder:['fn','fl']};
const row=(id:string,root=false)=>`<li data-type="navigation-${root?'root':'file'}" data-node-id="${id}" data-count="${children[id]?.length??0}"><span class="b3-list-item__toggle"><i class="b3-list-item__arrow"></i></span><span class="b3-list-item__text">${id}</span></li>`;
document.body.innerHTML=`<div class="file-tree sy__file"><div class="block__icons"><b class="block__logo">文档</b></div><div class="file-tree__items">${['book','sibling','normal'].map(id=>`<ul data-url="${id}">${row(id,true)}</ul>`).join('')}</div></div>`;
let blocked:string|undefined;
let adapter:DocumentTreeAdapter;
const paint=()=>{
  const groups=adapter.groups();
  adapter.present(groups.filter(g=>g.key!==blocked).map(group=>{
    const nodes=group.nodes.map(node=>({...node,role:(group.key==='root'||/n\d|sn|fn/.test(node.id))?'now' as const:'library' as const}));
    return {group:{...group,nodes},projection:projectTree(nodes,group.key==='root'?{kind:'root'}:{kind:'document',id:group.parentId??group.notebook,enabled:group.notebook!=='normal'},true)};
  }),false);
  if(blocked)adapter.stage(new Set([blocked]));
};
adapter=new DocumentTreeAdapter({refresh:paint,repaint:paint,toggleScope(){},changeRole(){},create(){}},document);
const active=new WeakMap<Element,Animation>();
document.querySelector('.file-tree')!.addEventListener('click',event=>{
  const target=(event.target as Element).closest('.b3-list-item__toggle');if(!target)return;
  const owner=target.parentElement as HTMLElement;
  const id=owner.dataset.nodeId!;
  const old=owner.nextElementSibling as HTMLElement|null;
  if(old&&active.has(old))return;
  const arrow=target.querySelector('.b3-list-item__arrow')!;
  if(arrow.classList.contains('b3-list-item__arrow--open')&&old) {
    arrow.classList.remove('b3-list-item__arrow--open');old.style.overflow='clip';
    const animation=old.animate([{height:`${old.scrollHeight}px`},{height:'0px'}],{duration:200,easing:'ease-out',fill:'both'});active.set(old,animation);
    void animation.finished.then(()=>{active.delete(old);old.remove();animation.cancel();},()=>{active.delete(old);old.remove();});
  } else {
    arrow.classList.add('b3-list-item__arrow--open');const list=document.createElement('ul');
    list.innerHTML=(children[id]??[]).map(child=>row(child)).join('');owner.after(list);list.style.overflow='clip';
    const animation=list.animate([{height:'0px'},{height:`${list.scrollHeight}px`}],{duration:200,easing:'ease-out',fill:'both'});active.set(list,animation);
    void animation.finished.then(()=>{active.delete(list);animation.cancel();list.style.removeProperty('overflow');},()=>{active.delete(list);list.style.removeProperty('overflow');});
  }
});
paint();
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
const title=(id:string)=>document.querySelector<HTMLElement>(`li[data-node-id="${id}"] .b3-list-item__text`)!;
const list=(id:string)=>title(id).parentElement!.nextElementSibling as HTMLElement;
const section=(key:string,role:string)=>document.querySelector<HTMLButtonElement>(`.yzc-section[data-yzc-group="${key}"][data-yzc-role="${role}"] button`)!;
const state=(key:string)=>['now','library','inbox'].map(role=>section(key,role).getAttribute('aria-expanded'));
const check=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
const sample=async(el:HTMLElement)=>{
  // MutationObserver commits before the first paint, not inside dispatchEvent.
  await Promise.resolve();
  const heights:number[]=[];const timings:number[]=[];
  const until=performance.now()+310;
  do {heights.push(el.isConnected?el.getBoundingClientRect().height:0);for(const a of el.getAnimations())timings.push(Number(a.effect!.getTiming().duration));await frame();}while(performance.now()<until);
  check(timings.every(t=>t===170),'all running transitions use 170ms');
  return {heights:heights.map(v=>Math.round(v*100)/100),timings:[...new Set(timings)]};
};
(window as any).runMotionChecks=async()=>{
  const results:Record<string,unknown>={};
  title('normal').click();await Promise.resolve();await Promise.resolve();
  results.normal=await sample(list('normal'));
  title('sibling').click();await sample(list('sibling'));
  section('sibling/','library').click();await sample(list('sibling'));
  blocked='book/';title('book').click();await frame();
  check(list('book').getBoundingClientRect().height===0,'unknown metadata stays at zero, not raw-tree height');
  check(list('book').getAnimations()[0].playState==='paused','native load waits for final projection');
  blocked=undefined;paint();results.local=await sample(list('book'));
  check(JSON.stringify(state('book/'))==='["true","false","false"]','initial NOW only');
  const local=results.local as {heights:number[]};
  check(Math.max(...local.heights)<=local.heights.at(-1)!+1,'no raw height overshoot');
  section('book/','library').click();results.sectionOpen=await sample(list('book'));
  check(list('book').querySelector('[data-node-id="l1"]')!.getBoundingClientRect().height>0,'Library shows rows');
  title('book').click();const closing=list('book');results.close=await sample(closing);
  check(!closing.isConnected,'native removal callback retained');
  title('book').click();results.reopen=await sample(list('book'));
  check(JSON.stringify(state('book/'))==='["true","false","false"]','reopen resets own scope');
  check(section('sibling/','library').getAttribute('aria-expanded')==='true','sibling state untouched');
  section('book/','now').click();await sample(list('book'));
  title('book').click();await sample(list('book'));
  title('book').click();results.allClosedReopen=await sample(list('book'));
  const trace=results.allClosedReopen as {heights:number[]};
  check(Math.max(...trace.heights)<=trace.heights.at(-1)!+1,'all-closed reopen never stretches beyond final NOW height');
  check(JSON.stringify(state('book/'))==='["true","false","false"]','all-closed reopen resets');
  adapter.configureFocus(true);
  check(document.querySelector('.file-tree__items')!.getAnimations().length===1,'Focus ON has one fade owner');
  results.focusOn=await sample(document.querySelector('.file-tree__items')!);
  section('book/','library').click();await sample(list('book'));
  (document.querySelector('.yzc-focus-back') as HTMLElement).click();await sample(document.querySelector('.file-tree__items')!);
  title('book').click();await sample(document.querySelector('.file-tree__items')!);
  check(JSON.stringify(state('book/'))==='["true","false","false"]','focus back/reentry resets');
  adapter.configureFocus(false);results.focusOff=await sample(document.querySelector('.file-tree__items')!);
  // Single-section switches reuse the same atomic 170ms motion commit.
  adapter.resetSections();paint();adapter.configureSingleSection(true);
  section('book/','library').click();results.singleSection=await sample(list('book'));
  check(JSON.stringify(state('book/'))==='["false","true","false"]','single Local only Library');
  check(JSON.stringify(state('root'))==='["true","false","false"]','Local switch leaves Root independent');
  section('root','library').click();await sample(document.querySelector('.file-tree__items')!);
  check(JSON.stringify(state('root'))==='["false","true","false"]','single Root Library');
  section('root','inbox').click();await sample(document.querySelector('.file-tree__items')!);
  check(JSON.stringify(state('root'))==='["false","false","true"]','single Root Inbox');
  section('root','now').click();await sample(document.querySelector('.file-tree__items')!);
  adapter.configureFocus(true);await sample(document.querySelector('.file-tree__items')!);
  section('book/','now').click();await sample(list('book'));
  check(JSON.stringify(state('book/'))==='["true","false","false"]','single + focus Now');
  adapter.configureFocus(false);await sample(document.querySelector('.file-tree__items')!);
  const previousBookList=list('book');title('sibling').click();results.notebookSwitch=await sample(list('sibling'));
  check(!previousBookList.isConnected,'single-section closes a sibling notebook through native removal');
  check(!title('book').parentElement!.querySelector('.b3-list-item__arrow--open'),'previous notebook is collapsed');
  title('book').click();results.notebookReturn=await sample(list('book'));
  check(JSON.stringify(state('book/'))==='["true","false","false"]','notebook accordion reentry resets Local to NOW');
  // Interrupt a section animation, then clean up exactly while it is running.
  section('book/','library').click();await frame();section('book/','library').click();await frame();
  adapter.dispose();await frame();
  check(document.getAnimations().length===0,'cleanup releases all own/native animations');
  check(!document.querySelector('.yzc-section,.yzc-focus-current'),'cleanup removes projection');
  check(![...document.querySelectorAll<HTMLElement>('.file-tree li,.file-tree ul')].some(el=>el.style.display||el.style.minHeight||el.style.boxSizing),'temporary motion styles restored');
  const outer=document.createElement('div'),inner=document.createElement('div');
  inner.innerHTML='<div style="height:80px"></div>';outer.append(inner);document.body.append(outer);
  const parentAnimation=outer.animate([{height:'0px'},{height:'950px'}],{duration:200,fill:'both'});
  const childAnimation=inner.animate([{height:'0px'},{height:'900px'}],{duration:200,fill:'both'});
  const motion=new TreeMotion(document);
  motion.settle([{list:outer,settled:true},{list:inner,settled:true}],false);
  check(childAnimation.playState==='finished','nested child does not own a competing height transition');
  check((parentAnimation.effect as KeyframeEffect).getKeyframes().at(-1)!.height==='80px','parent measures final child DOM, not stale fill height');
  motion.dispose();parentAnimation.cancel();childAnimation.cancel();outer.remove();
  results.nestedNative='one owner; final target 80px instead of stale 950px';
  return results;
};
