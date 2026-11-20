export function el<K extends keyof HTMLElementTagNameMap>(tag:K,className='',text?:string):HTMLElementTagNameMap[K]{
  const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;
}
export function button(text:string,click:()=>void,className='rss-button'):HTMLButtonElement{
  const node=el('button',className,text);node.type='button';node.onclick=click;return node;
}
const SVG_NS='http://www.w3.org/2000/svg';
/** Geometry copied verbatim from SiYuan's own icon set so RSS matches the book room and host chrome. */
const STROKE='fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
const ICONS:Record<string,{viewBox:string;body:string}>={
  'all-articles':{viewBox:'0 0 24 24',body:'<path d="M4 4v16M9 4v16M14 5l5 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'},
  'later-nav':{viewBox:'0 0 14 17',body:'<path d="M3 1.5H11V15.1L7 12.3L3 15.1V1.5Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/>'},
  later:{viewBox:'0 0 14 17',body:'<path d="M3 1.5H11V15.1L7 12.3L3 15.1V1.5Z" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/>'},
  'later-filled':{viewBox:'0 0 14 17',body:'<path d="M3.1 1.1H10.9C11.45 1.1 11.9 1.55 11.9 2.1V15.4L7 12.35L2.1 15.4V2.1C2.1 1.55 2.55 1.1 3.1 1.1Z" fill="currentColor" stroke="none"/>'},
  history:{viewBox:'0 0 24 24',body:'<path d="M10 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5M6 7h10M6 11h7M6 15h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="17" cy="17" r="5" stroke="currentColor" stroke-width="1.6"/><path d="M17 14v3l2 1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'},
  bilingual:{viewBox:'0 0 24 24',body:'<path d="M3 7h17m-5-4 5 4-5 4M21 17H4m5-4-5 4 5 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'},
  inbox:{viewBox:'0 0 17 17',body:'<path d="M4.25 12.75L12.75 4.25M12.75 11.05V4.25H5.95" stroke="currentColor" stroke-width="1.275" stroke-linecap="round" stroke-linejoin="round"/>'},
  'inbox-completed':{viewBox:'0 0 17 17',body:'<path d="M4.25 12.75L12.75 4.25M12.75 11.05V4.25H5.95" stroke="currentColor" stroke-width="2.21" stroke-linecap="round" stroke-linejoin="round"/>'},
  'tag-add':{viewBox:'0 0 16 16',body:'<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'},
  book:{viewBox:'0 0 24 24',body:`<g ${STROKE}><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></g>`},
  document:{viewBox:'0 0 24 24',body:`<g ${STROKE}><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/></g>`},
  chevron:{viewBox:'0 0 16 16',body:'<path d="m6 3 5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'},
  iconRefresh:{viewBox:'0 0 24 24',body:`<g ${STROKE}><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></g>`},
  iconSettings:{viewBox:'0 0 24 24',body:`<g ${STROKE}><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></g>`},
  iconTrashcan:{viewBox:'0 0 24 24',body:`<g ${STROKE}><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></g>`},
  iconBack:{viewBox:'0 0 24 24',body:`<g ${STROKE}><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></g>`},
};
/** Inline icons remain usable even when plugin asset requests or the host sprite are unavailable. */
export function rssIcon(asset:string):SVGSVGElement{
  if(asset==='settings')asset='iconSettings';
  const definition=ICONS[asset],resolved=definition??ICONS.document,svg=document.createElementNS(SVG_NS,'svg');
  svg.setAttribute('viewBox',resolved.viewBox);svg.setAttribute('fill','none');svg.setAttribute('aria-hidden','true');svg.classList.add('rss-icon');svg.dataset.asset=asset;
  if(!definition)svg.dataset.unknown='1';
  svg.innerHTML=resolved.body;svg.querySelectorAll('path,circle').forEach(node=>{if(!node.hasAttribute('fill'))node.setAttribute('fill','none');});return svg;
}
export function iconButton(label:string,asset:string,click:()=>void,withLabel=false):HTMLButtonElement{
  const node=button('',click,withLabel?'rss-action':'rss-icon-button');
  node.title=label;node.setAttribute('aria-label',label);node.append(rssIcon(asset));
  if(withLabel)node.append(el('span','',label));return node;
}
/** Keep the public helper name while using the same inline icon geometry as the rest of RSS. */
export function hostIconButton(label:string,symbol:string,click:()=>void):HTMLButtonElement{
  const node=iconButton(label,symbol,click);return node;
}
export function articleBack(click:()=>void):HTMLButtonElement{
  const node=hostIconButton('← 返回文章列表','iconBack',click);node.className='rss-back yzc-navigation-back';node.append(el('span','','返回文章列表'));return node;
}
export function input(label:string,value='',type='text'): {wrap:HTMLLabelElement;field:HTMLInputElement}{
  const wrap=el('label','rss-field');wrap.append(el('span','',label));const field=el('input');field.type=type;field.value=value;wrap.append(field);return {wrap,field};
}
export const tagsFrom=(value:string)=>[...new Set(value.split(/[,，]/).map(x=>x.trim()).filter(Boolean))];
export function checkbox(label:string,checked:boolean,change:(value:boolean)=>void,partial=false):HTMLLabelElement{
  const wrap=el('label','rss-check'),box=el('input');box.type='checkbox';box.checked=checked;box.indeterminate=partial;
  box.setAttribute('aria-label',label);box.onchange=()=>change(box.checked);wrap.append(box,el('span','',label));return wrap;
}
export async function action(node:HTMLButtonElement,work:()=>Promise<unknown>,error:(e:unknown)=>void):Promise<void>{
  node.disabled=true;
  try{await work();}catch(e){error(e);}finally{node.disabled=false;}
}
