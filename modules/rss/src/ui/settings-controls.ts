import {el,button} from './dom';
let selectId=0;
/** Shares the existing group-picker surface; no document listeners or native popup. */
export function selectMenu(label:string,options:string[],initial:string,change:()=>void):{wrap:HTMLElement;readonly value:string}{
 const wrap=el('div','rss-select'),details=el('details'),summary=el('summary'),menu=el('div','rss-group-menu rss-select-menu');let value=initial;
 menu.id='rss-select-'+ ++selectId;menu.setAttribute('role','listbox');menu.setAttribute('aria-label',label);summary.setAttribute('role','combobox');summary.setAttribute('aria-label',label);summary.setAttribute('aria-controls',menu.id);summary.setAttribute('aria-haspopup','listbox');summary.setAttribute('aria-expanded','false');details.append(summary,menu);wrap.append(details);
 const close=(focus=false)=>{details.open=false;summary.setAttribute('aria-expanded','false');if(focus)summary.focus({preventScroll:true});};
 const draw=()=>{summary.textContent=value;menu.replaceChildren();for(const text of options){const choice=button(text,()=>{const changed=text!==value;value=text;draw();close(true);if(changed)change();},'rss-select-option');choice.setAttribute('role','option');choice.setAttribute('aria-selected',String(text===value));choice.tabIndex=-1;menu.append(choice);}};
 const focus=(index:number)=>{details.open=true;summary.setAttribute('aria-expanded','true');(menu.children[(index+options.length)%options.length] as HTMLElement)?.focus();};
 details.ontoggle=()=>summary.setAttribute('aria-expanded',String(details.open));details.onkeydown=e=>{const at=[...menu.children].indexOf(document.activeElement as Element);if(e.key==='Escape'&&details.open){e.preventDefault();e.stopPropagation();close(true);}else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();focus(e.key==='Home'?0:e.key==='End'?options.length-1:at<0?Math.max(0,options.indexOf(value)):at+(e.key==='ArrowDown'?1:-1));}};
 details.addEventListener('focusout',e=>{if(e.relatedTarget&&!details.contains(e.relatedTarget as Node))close();});draw();return{wrap,get value(){return value;}};
}
export function segmented(items:string[],selected:number,change:(index:number)=>void,label:string):HTMLElement{
 const root=el('div','rss-segmented');root.setAttribute('role','group');root.setAttribute('aria-label',label);
 const select=(index:number)=>{root.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));change(index);};
 items.forEach((text,i)=>{const b=button(text,()=>select(i));b.setAttribute('aria-pressed',String(i===selected));b.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();const next=(i+(e.key==='ArrowRight'?1:-1)+items.length)%items.length;(root.children[next] as HTMLElement).focus();select(next);}};root.append(b);});return root;
}
