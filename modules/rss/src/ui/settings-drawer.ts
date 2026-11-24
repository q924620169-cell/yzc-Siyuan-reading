import {el,button,checkbox,input} from './dom';
import {foldContent,motion,playMotion} from '../../../../shared/motion.js';
export function groupPicker(groups:string[],initial:string[]=[],label='所属分组'):{wrap:HTMLElement;value:()=>string[]}{
 const selected=new Set(initial),available=new Set([...groups,...initial]),wrap=el('div','rss-field rss-group-picker'),details=el('details'),summary=el('summary'),choices=el('div','rss-group-choices'),search=input('新增或搜索分组');search.field.placeholder='输入名称，Enter 新建并选中';wrap.append(el('span','',label),details);const menu=el('div','rss-group-menu');menu.append(search.wrap,choices);details.append(summary,menu);summary.setAttribute('aria-label',label);
 const draw=()=>{const focus=choices.contains(document.activeElement)?document.activeElement?.getAttribute('aria-label'):null,top=choices.scrollTop;summary.replaceChildren();if(!selected.size)summary.append(el('span','rss-muted','不分组'));else{for(const name of [...selected].slice(0,2))summary.append(el('span','rss-group-chip',name));if(selected.size>2)summary.append(el('span','rss-muted',`+${selected.size-2}`));}summary.title=[...selected].join('、');choices.replaceChildren();for(const name of [...available].filter(n=>n.toLowerCase().includes(search.field.value.toLowerCase())))choices.append(checkbox(name,selected.has(name),yes=>{yes?selected.add(name):selected.delete(name);draw();}));choices.scrollTop=top;if(focus)choices.querySelector<HTMLInputElement>(`input[aria-label="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});};search.field.oninput=draw;search.field.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();const name=search.field.value.trim();if(name){available.add(name);selected.add(name);search.field.value='';draw();}}};details.addEventListener('focusout',e=>{if(e.relatedTarget&&!details.contains(e.relatedTarget as Node))details.open=false;});draw();return{wrap,value:()=>[...selected]};
}
export function openDrawer(host:HTMLElement,title:string,render:(body:HTMLElement,close:()=>Promise<void>)=>void):()=>Promise<void>{
 const existing=host.querySelector('.rss-drawer-overlay:not([inert])');if(existing)return()=>Promise.resolve();const previous=document.activeElement as HTMLElement|null,layout=host.querySelector<HTMLElement>('.rss-settings-layout'),wasInert=layout?.inert??false;const root=el('div','rss-drawer-overlay'),shade=el('div','rss-drawer-shade'),panel=el('section','rss-drawer-panel'),head=el('header','rss-drawer-head'),body=el('div','rss-drawer-body');body.addEventListener('pointerdown',e=>{for(const d of body.querySelectorAll<HTMLDetailsElement>('.rss-group-picker details[open]'))if(!d.contains(e.target as Node))d.open=false;});panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',title);root.append(shade,panel);panel.append(head,body);
 const hiddenPanel={transform:'translateX(100%)',opacity:.7},visiblePanel={transform:'translateX(0)',opacity:1};
 let entry:Animation|undefined, scrimEntry:Animation|undefined, closing:Promise<void>|undefined;
 const close=():Promise<void>=>{
  if(closing)return closing;
  const style=getComputedStyle(panel),current={transform:style.transform,opacity:style.opacity},opacity=getComputedStyle(shade).opacity;
  entry?.cancel();scrimEntry?.cancel();
  root.dataset.closing='true';root.inert=true;root.style.pointerEvents='none';
  if(layout)layout.inert=wasInert;
  if(previous?.isConnected)previous.focus({preventScroll:true});
  const duration=Math.max(1,motion.drawer.duration*Math.max(0,Math.min(1,Number(opacity))));
  const timing={...motion.drawer,duration,fill:'forwards' as const};
  const exit=playMotion(panel,[current,hiddenPanel],timing);
  const scrimExit=playMotion(shade,[{opacity},{opacity:0}],timing);
  if(!exit){root.remove();return closing=Promise.resolve();}
  closing=Promise.allSettled([exit.finished,scrimExit?.finished]).then(()=>{root.remove();});
  return closing;
 };
 head.append(button('← 返回',()=>void close(),'rss-text-button'),el('h2','',title));shade.onclick=()=>void close();root.addEventListener('rss-drawer-close',()=>void close());host.append(root);if(layout)layout.inert=true;render(body,close);
 entry=playMotion(panel,[hiddenPanel,visiblePanel],motion.drawer);
 scrimEntry=playMotion(shade,[{opacity:0},{opacity:1}],motion.drawer);
 panel.querySelector<HTMLElement>('input,button,select,summary')?.focus({preventScroll:true});return close;
}
export function expandRelations(panel:HTMLElement,open:boolean):void {
 foldContent(panel,open,{maxHeight:220});
}
