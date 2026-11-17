import {safeHtml} from './content';
import {digest,type Article,type ArticleBody} from './model';
import {unit,escapeText,needsTranslation,type Unit,type TranslationPlan,type TranslationResult} from './translation-protocol';
export type {TranslationPlan,TranslationResult,Unit};
const blocks='p,h1,h2,h3,h4,h5,h6,figcaption,dt,dd,li,td,th,[data-rss-run]';
const excluded='pre,code,kbd,samp,math,script,style,[data-type="inline-math"],[data-type="math"]';
export const hasEnglish=(text:string):boolean=>{const latin=(text.match(/[a-zA-Z]/g)??[]).length,han=(text.match(/[\u3400-\u9fff]/g)??[]).length;return latin>=2&&han<latin*.35;};
export const hasEmphasis=(u:Unit):boolean=>u.markup===true&&/<(?:strong|em|b|i)(?:\s|>)/i.test(u.html??'');
export async function unitHash(u:Unit):Promise<string>{return digest(JSON.stringify([u.source,u.tokens,u.markupTokens??[],hasEmphasis(u)?'inline-2-emphasis':u.markup?'inline-1':'plain-1']));}
/** Only sanitized source tags become protected tokens. Model characters are escaped before restoration. */
export function semanticUnit(id:string,html:string):Unit{
  const doc=new DOMParser().parseFromString(html,'text/html'),tokens:string[]=[],markupTokens:number[]=[];
  const token=(value:string,markup=false)=>{const i=tokens.length;tokens.push(value);if(markup)markupTokens.push(i);return `⟦P${i}⟧`;};
  const walk=(node:Node):string=>{
    if(node.nodeType===3){const u=unit('',node.textContent??'');let source=u.source;const offset=tokens.length;u.tokens.forEach(t=>tokens.push(t));source=source.replace(/⟦P(\d+)⟧/g,(_,i)=>`⟦P${Number(i)+offset}⟧`);return (node.textContent?.match(/^\s*/)?.[0]??'')+source+(node.textContent?.match(/\s*$/)?.[0]??'');}
    if(node.nodeType!==1)return '';const el=node as Element;
    if(el.matches('img,br,hr,'+excluded))return token(el.outerHTML,true);
    const clone=el.cloneNode(false) as Element,outer=clone.outerHTML,open=outer.slice(0,outer.indexOf('>')+1),close=`</${el.tagName.toLowerCase()}>`;
    return token(open,true)+[...el.childNodes].map(walk).join('')+token(close,true);
  };
  return{id,text:doc.body.textContent??'',source:[...doc.body.childNodes].map(walk).join(''),tokens,markupTokens,markup:true,html};
}
function fragments(node:Element):string[]{
  const text=node.textContent??'';if(text.length<=1100)return[node.innerHTML];
  const sentences=[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(text)],cuts:number[]=[];let at=0;
  for(const s of sentences){const end=s.index+s.segment.length;if(end-at>1100&&s.index>at){cuts.push(s.index);at=s.index;}while(end-at>1100){const word=text.lastIndexOf(' ',at+1100);if(word<=at)break;cuts.push(word+1);at=word+1;}}
  cuts.push(text.length);if(cuts.length===1)return[node.innerHTML];
  const walker=node.ownerDocument.createTreeWalker(node,4),texts:Text[]=[];while(walker.nextNode())texts.push(walker.currentNode as Text);
  const point=(offset:number):[Node,number]=>{let n=offset;for(const t of texts){if(n<=t.length)return[t,n];n-=t.length;}return[node,node.childNodes.length];};
  let start=0;return cuts.map(end=>{const range=node.ownerDocument.createRange();range.setStart(...(start===0?[node,0] as [Node,number]:point(start)));range.setEnd(...(end===text.length?[node,node.childNodes.length] as [Node,number]:point(end)));start=end;const wrap=node.ownerDocument.createElement('div');wrap.append(range.cloneContents());return wrap.innerHTML;});
}
export async function translationPlan(article:Article,body:ArticleBody):Promise<TranslationPlan>{
  const clean=safeHtml(body.html,article.url),doc=new DOMParser().parseFromString(clean,'text/html'),units:Unit[]=[];
  for(const parent of [doc.body,...doc.body.querySelectorAll('div,li,td,th,blockquote')]){
    let run:Node[]=[];const flush=()=>{if(run.some(n=>(n.textContent??'').trim())){const p=doc.createElement('div');p.dataset.rssRun='';parent.insertBefore(p,run[0]);run.forEach(n=>p.append(n));}run=[];};
    for(const child of [...parent.childNodes]){if(child.nodeType===1&&(child as Element).matches('p,div,ul,ol,li,table,blockquote,pre,h1,h2,h3,h4,h5,h6,figure,hr'))flush();else run.push(child);}flush();
  }
  if(hasEnglish(article.title))units.push(unit('title-0',article.title));
  let i=0;for(const block of [...doc.body.querySelectorAll(blocks)]){
    if(block.closest(excluded)||block.querySelector(blocks)||!hasEnglish(block.textContent??''))continue;
    const id=`b${i++}`;block.setAttribute('data-rss-block',id);const parts=fragments(block);block.replaceChildren();
    for(let j=0;j<parts.length;j++){const key=`${id}-${j}`,u=semanticUnit(key,parts[j]),span=doc.createElement('span');span.dataset.rssPart=key;span.innerHTML=parts[j];block.append(span);units.push(u);}
  }
  await Promise.all(units.map(async u=>u.hash=await unitHash(u)));
  return{id:article.id,title:article.title,fingerprint:await digest(clean),html:doc.body.innerHTML,units,needed:units.length>0};
}
export function translatedContent(result:TranslationResult,bilingual=false):{title:string;html:string}{
  const {plan,cache}=result,doc=new DOMParser().parseFromString(plan.html,'text/html');
  const originals=new Map<string,Element>();doc.querySelectorAll('[data-rss-block]').forEach(el=>originals.set(el.getAttribute('data-rss-block')!,el.cloneNode(true) as Element));
  for(const part of doc.querySelectorAll<HTMLElement>('[data-rss-part]')){const id=part.dataset.rssPart!,value=cache.parts[id];if(value!==undefined)part.innerHTML=value;else{const length=part.textContent?.length??0;part.classList.add('rss-translation-pending');part.textContent='正在翻译这一段…';part.style.minHeight=`${Math.max(1,Math.ceil(length/75))*1.65}em`;}}
  if(bilingual)for(const [id,source] of originals){const translated=doc.querySelector(`[data-rss-block="${id}"]`)!;source.removeAttribute('data-rss-block');source.classList.add('rss-original-block');const clone=translated.cloneNode(true) as Element;clone.removeAttribute('data-rss-block');clone.classList.add('rss-translated-block');clone.querySelectorAll('img').forEach(i=>i.remove());const pair=doc.createElement('div');pair.dataset.rssBlock=id;pair.classList.add('rss-bilingual-pair');translated.replaceWith(pair);pair.append(source,clone);}
  return{title:cache.parts['title-0']??plan.title,html:doc.body.innerHTML};
}
export const plainTranslation=(u:Unit,value:string):string=>u.markup?new DOMParser().parseFromString(value,'text/html').body.textContent??'':value;
export {escapeText};
