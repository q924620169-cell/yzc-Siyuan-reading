import {DocumentTreeAdapter} from '../../plugin/src/adapters/document-tree-adapter';
import {projectTree} from '../../plugin/src/inl/inl-tree';

// SiYuan 3.8.10 keeps expanded branches in one native list and reconciles rows.
const books = ['book', 'sibling'];
let childCount = 6;
let delaySibling = false;
let holdLoad = false;
const row = (book: string, child?: string): HTMLElement => {
  const el = document.createElement('li');
  el.className = 'file-tree__row';
  el.dataset.type = child ? 'navigation-file' : 'navigation-root';
  el.dataset.treeKey = `notebook:${book}${child ? '/'+child : ''}`;
  el.dataset.nodeId = child ?? '';
  if (!child) el.setAttribute('aria-expanded','false');
  el.innerHTML = `<span class="b3-list-item__toggle"><i class="b3-list-item__arrow"></i></span><span class="b3-list-item__text">${child ?? book}</span>`;
  return el;
};
document.body.innerHTML = '<div class="file-tree sy__file"><div class="block__icons"></div><div class="file-tree__items"><ul role="tree"></ul></div></div>';
const list = document.querySelector<HTMLElement>('ul[role="tree"]')!;
const roots = books.map(book => row(book));
list.append(...roots);
let adapter: DocumentTreeAdapter;
let fullRefreshes=0;
const paint = () => {
  const views = adapter.groups().map(group => {
    const nodes = group.nodes.map(node => ({...node, role:node.id.endsWith('library') ? 'library' as const : 'now' as const}));
    const scope=group.key==='root' ? {kind:'root' as const}
      : {kind:'document' as const,id:group.parentId??'notebook:'+group.notebook,enabled:!group.parentId};
    return {group:{...group,nodes}, projection:projectTree(nodes,scope,true)};
  });
  adapter.present(views,false);
};
adapter = new DocumentTreeAdapter({refresh:()=>{fullRefreshes++;paint();},repaint:paint,toggleScope(){},changeRole(){},create(){}});
document.querySelector('.file-tree')!.addEventListener('click', event => {
  const toggle = (event.target as Element).closest('.b3-list-item__toggle');
  if (!toggle) return;
  const owner = toggle.parentElement as HTMLElement;
  const key = owner.dataset.treeKey!;
  const open = owner.getAttribute('aria-expanded') !== 'true';
  const publish=()=>{
    owner.removeAttribute('aria-busy');
    owner.setAttribute('aria-expanded',String(open));
    owner.querySelector('.b3-list-item__arrow')!.classList.toggle('b3-list-item__arrow--open',open);
    if (open) {
      const children = [...Array.from({length:childCount},(_,i)=>`now-${i}`),'library'].map(child=>row(key.slice('notebook:'.length),child));
      owner.after(...children);
      if(holdLoad) {
        const loading=document.createElement('li');
        loading.dataset.treeLoading='true';loading.style.height='30px';list.append(loading);
        const spacer=document.createElement('li');
        spacer.dataset.treeSpacer='true';spacer.style.height='30px';list.append(spacer);
        setTimeout(()=>loading.remove(),70);
      }
    } else {
      // The adapter defers this native removal until the region is closed.
      list.querySelectorAll<HTMLElement>('[data-tree-key]').forEach(el=>{
        if (el.dataset.treeKey!.startsWith(key+'/')) el.remove();
      });
    }
  };
  if(open && delaySibling && key==='notebook:sibling') {
    owner.setAttribute('aria-busy','true');setTimeout(publish,70);
  } else publish();
});
document.querySelector('.file-tree__items')!.addEventListener('scroll',()=>{
  list.querySelectorAll('[data-tree-spacer]').forEach(spacer=>spacer.remove());
});
paint();
adapter.configureSingleSection(true);
const check = (condition:unknown,message:string) => {if (!condition) throw new Error(message);};
const frame = () => new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
const settle = async () => {
  const deadline = performance.now()+500;
  do {await frame();} while(document.getAnimations().length && performance.now()<deadline);
  check(!document.getAnimations().length,'flat transitions finish and release their fill effects');
};
const title = (book:string) => roots[books.indexOf(book)].querySelector<HTMLElement>('.b3-list-item__text')!;
const hint = () => document.querySelector<HTMLElement>('.yzc-crowded:not(.yzc-role-hidden)')!;
const nowHeader = (book:string) => document.querySelector<HTMLElement>(`.yzc-section[data-yzc-group="${book}/"][data-yzc-role="now"]`)!;
const crowdedGeometry = (book:string) => {
  const message = hint();
  const now = nowHeader(book);
  const last = list.querySelector<HTMLElement>(`[data-tree-key="notebook:${book}/now-${childCount-1}"]`)!;
  const library = document.querySelector<HTMLElement>(`.yzc-section[data-yzc-group="${book}/"][data-yzc-role="library"]`)!;
  const rect = message.getBoundingClientRect();
  check(rect.top >= last.getBoundingClientRect().bottom,'crowded hint follows the final NOW row');
  check(rect.bottom <= library.getBoundingClientRect().top,'crowded hint stays inside NOW before Library');
  check(Math.abs(rect.left-now.getBoundingClientRect().left)<1,'crowded hint shares the Local section inset');
  return {hintTop:rect.top,lastBottom:last.getBoundingClientRect().bottom,left:rect.left};
};

(window as any).runFlatMotionChecks = async () => {
  await new Promise(resolve=>setTimeout(resolve,120));
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const items=document.querySelector<HTMLElement>('.file-tree__items')!;
  const second=roots[1];
  const painted=()=>{
    return [...items.querySelectorAll<HTMLElement>('li[data-tree-key],.yzc-section,.yzc-crowded')].flatMap(el=>{
      const rect=el.getBoundingClientRect();
      if(!rect.height)return [];
      const style=getComputedStyle(el);
      if(style.visibility==='hidden')return [];
      const clip=style.clipPath;
      const parts=clip.startsWith('inset(')?clip.slice(6,-1).split(/\s+/).map(parseFloat):[];
      const bottom=parts.length>2?parts[2]:parts[0]||0;
      const height=Math.max(0,rect.height-bottom);
      return height>.1?[{el,top:rect.top,bottom:rect.top+height}]:[];
    }).sort((a,b)=>a.top-b.top);
  };
  const verify=()=>{
    const rows=painted();
    check(rows.every((row,i)=>!i||row.top>=rows[i-1].bottom-1),'painted branch regions never overlap');
    return rows;
  };
  const at=async(time:number)=>{
    await frame();
    for(const animation of document.getAnimations()) {
      animation.pause();animation.currentTime=time;
    }
    await frame();await frame();
    verify();
    return second.getBoundingClientRect().top;
  };
  const finish=async()=>{
    for(const animation of document.getAnimations())animation.finish();
    await settle();
    verify();
  };
  const initial=second.getBoundingClientRect().top;
  roots[0].click();
  await Promise.resolve();
  const opening=[];
  const nativeHeights:number[]=[];
  for(const time of [0,85,170]){
    opening.push(await at(time));
    nativeHeights.push(roots[0].getBoundingClientRect().height);
  }
  check(nativeHeights.every(height=>height===nativeHeights[0]),'native row height stays constant for virtualization measurements');
  if(!reduced) {
    check(Math.abs(opening[0]-initial)<1,'opening starts at the original occupied height');
    check(opening[1]>opening[0]+5&&opening[1]<opening[2]-1,'opening visibly moves following nodes through an intermediate height');
    check(document.getAnimations().length===1,'one shared timeline controls the whole reveal');
  }
  await finish();
  const before=crowdedGeometry('book');
  const changedFont=document.createElement('style');
  changedFont.textContent='.yzc-section button{line-height:20px}';
  document.head.append(changedFont);
  const expanded=second.getBoundingClientRect().top;
  title('book').click();
  await Promise.resolve();
  const closing=[];
  for(const time of [0,85,170])closing.push(await at(time));
  if(!reduced){
    check(Math.abs(closing[0]-expanded)<1,'closing retains its starting geometry');
    check(closing[1]<closing[0]-5&&closing[1]>closing[2]+1,'closing continuously releases occupied space');
    check(list.querySelector('[data-tree-key="notebook:book/now-0"]')?.isConnected,'native rows remain owned by the host until exit completes');
  }
  await finish();
  changedFont.remove();
  check(!list.querySelector('[data-tree-key="notebook:book/now-0"]'),'native collapse commits after the exit timeline');
  roots[0].click();await settle();
  check(roots[0].getAttribute('aria-expanded')==='true','the first whole-row click after collapse updates notebook intent and opens');
  const firstPaint=painted();
  paint();
  check(!document.getAnimations().length,'metadata repaint creates no timeline');
  check(painted().every((row,i)=>row.el===firstPaint[i].el&&row.top===firstPaint[i].top),'metadata repaint preserves geometry');
  const library=document.querySelector<HTMLButtonElement>('.yzc-section[data-yzc-group="book/"][data-yzc-role="library"] button')!;
  const refreshesBeforeFold=fullRefreshes;
  library.click();
  check(fullRefreshes===refreshesBeforeFold,'section visibility changes do not request a redundant full metadata refresh');
  await Promise.resolve();
  const sections=[];
  for(const time of [0,85,170])sections.push(await at(time));
  if(!reduced)check(Math.abs(sections[1]-sections[0])>1&&Math.abs(sections[1]-sections[2])>1,'section switching has an observable middle frame');
  await finish();
  const now=document.querySelector<HTMLButtonElement>('.yzc-section[data-yzc-group="book/"][data-yzc-role="now"] button')!;
  now.click();await settle();
  if(!reduced){
    title('book').click();await Promise.resolve();await at(65);
    const interrupted=second.getBoundingClientRect().top;
    title('book').click();await Promise.resolve();await at(0);
    check(Math.abs(second.getBoundingClientRect().top-interrupted)<1,'rapid reversal starts at the current region height');
    await finish();
    check(roots[0].getAttribute('aria-expanded')==='true','rapid close/open keeps the final open intent');
  }
  title('sibling').click();
  await Promise.resolve();
  for(const time of [0,85,170])await at(time);
  await finish();
  check(!roots[0].querySelector('.b3-list-item__arrow--open'),'accordion native removal completes');
  const after=crowdedGeometry('sibling');
  title('book').click();await settle();
  delaySibling=true;
  title('book').click();await frame();
  title('sibling').click();await frame();
  title('book').click();
  await new Promise(resolve=>setTimeout(resolve,90));await settle();
  check(roots[0].getAttribute('aria-expanded')==='true' && roots[1].getAttribute('aria-expanded')==='false',
    'a slower notebook load cannot override the last rapid-switch intent');
  delaySibling=false;
  adapter.configureFocus(true);await settle();
  now.click();await settle();
  adapter.configureFocus(false);await settle();
  if(roots[0].getAttribute('aria-expanded')==='true'){title('book').click();await settle();}
  childCount=300;
  const started=performance.now();
  title('book').click();await Promise.resolve();
  if(!reduced) {
    // A large host render can occupy the main thread before its first paint.
    // That work must not consume the complete 170ms transition off screen.
    const busy=performance.now();
    while(performance.now()-busy<210) { /* simulate native range preparation */ }
  }
  await frame();
  const longDirectoryMs=performance.now()-started;
  check(document.getAnimations().length<=1,'long branch has one timeline');
  if(!reduced)check(document.getAnimations().length===1,'slow native preparation cannot finish the reveal before its first frame');
  await finish();
  check(list.querySelectorAll('[data-type="navigation-file"]').length>=300,'long branch keeps native rows');
  check(items.clientHeight>=list.children.length*30,'virtual render budget includes the real native row height');
  title('book').click();await settle();
  holdLoad=true;
  const loadingTop=second.getBoundingClientRect().top;
  title('book').click();await Promise.resolve();await frame();
  if(!reduced)check(Math.abs(second.getBoundingClientRect().top-loadingTop)<1,'unloaded ranges stay closed before reveal');
  await new Promise(resolve=>setTimeout(resolve,90));
  if(!reduced)check(document.getAnimations().length===1,'materialized range starts one continuous reveal');
  await finish();
  title('book').click();await settle();
  title('book').click();await new Promise(resolve=>setTimeout(resolve,90));
  check(!list.querySelector('[data-tree-spacer]'),'reopening an equal-sized range requests native materialization again');
  await finish();
  holdLoad=false;
  const scroller=items.closest<HTMLElement>('.yzc-flat-scroll')!;
  scroller.style.height='220px';scroller.scrollTop=180;
  const scroll=scroller.scrollTop;
  paint();
  check(scroller.scrollTop===scroll,'repaint preserves scrolling');
  title('book').click();await Promise.resolve();await frame();
  adapter.dispose();
  check(!document.getAnimations().length,'unload cancels the shared timeline');
  check(!document.querySelector('.yzc-flat-scroll,.yzc-section'),'unload restores native containers');
  check(![...list.querySelectorAll<HTMLElement>('li')].some(el=>el.style.clipPath||el.style.transform||el.style.visibility),'unload restores temporary region styles');
  return {opening,closing,sections,before,after,longDirectoryMs,scroll,nativeHeights};
};
