export function el<K extends keyof HTMLElementTagNameMap>(tag:K,className='',text?:string):HTMLElementTagNameMap[K]{
  const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;
}
export function button(text:string,click:()=>void,className='rss-button'):HTMLButtonElement{
  const node=el('button',className,text);node.type='button';node.onclick=click;return node;
}
export function iconButton(label:string,asset:string,click:()=>void,withLabel=false):HTMLButtonElement{
  const node=button('',click,withLabel?'rss-action':'rss-icon-button');
  node.title=label;node.setAttribute('aria-label',label);
  const img=el('span','rss-icon');img.setAttribute('aria-hidden','true');img.dataset.asset=asset;img.style.setProperty('--rss-icon-url',`url("/plugins/yzc-Siyuan-reading/assets/rss/${asset}.svg")`);node.append(img);
  if(withLabel)node.append(el('span','',label));return node;
}
/** Use SiYuan's public icon sprite, shared with the book plugin. */
export function hostIconButton(label:string,symbol:string,click:()=>void):HTMLButtonElement{
  const node=button('',click,'rss-icon-button');node.title=label;node.setAttribute('aria-label',label);
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS('http://www.w3.org/2000/svg','use');
  svg.setAttribute('aria-hidden','true');use.setAttribute('href',`#${symbol}`);svg.append(use);node.append(svg);return node;
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
