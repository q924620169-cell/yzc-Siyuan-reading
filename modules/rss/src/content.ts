import DOMPurify from 'dompurify';
import {Readability} from '@mozilla/readability';
import TurndownService from 'turndown';
import {canonicalUrl} from './model';

export function safeHtml(html: string, base: string): string {
  const input=new DOMParser().parseFromString(html,'text/html');
  for(const img of input.querySelectorAll('img[data-src]')){
    const src=canonicalUrl(img.getAttribute('data-src')??'',base);
    if(src&&!imageCandidate(img.getAttribute('src')??'',base))img.setAttribute('src',src);
  }
  const clean=DOMPurify.sanitize(input.body.innerHTML,{
    USE_PROFILES:{html:true},
    FORBID_TAGS:['style','form','input','button','textarea','select','iframe','video','audio','source','object','embed','link','meta'],
    FORBID_ATTR:['style','id','class','srcset','name','contenteditable','autofocus'],
    ALLOW_DATA_ATTR:false,
  });
  const doc=new DOMParser().parseFromString(clean,'text/html');
  for (const el of doc.querySelectorAll('[href],[src]')) {
    for (const attr of ['href','src']) if (el.hasAttribute(attr)) {
      const url=canonicalUrl(el.getAttribute(attr)!,base);
      if(url)el.setAttribute(attr,url);else el.removeAttribute(attr);
    }
    if(el.tagName==='A'){el.setAttribute('rel','noopener noreferrer');el.setAttribute('target','_blank');}
    if(el.tagName==='IMG'){el.setAttribute('loading','lazy');el.setAttribute('referrerpolicy','no-referrer');}
  }
  return doc.body.innerHTML;
}
export function plain(html: string): string {
  const doc=new DOMParser().parseFromString(html,'text/html');
  doc.querySelectorAll('script,style').forEach(x=>x.remove());
  return (doc.body.textContent??'').replace(/\s+/g,' ').trim();
}
export function imageCandidate(url: string, base: string, width?: number, height?: number, hint=''): string | undefined {
  const resolved=canonicalUrl(url,base);
  if(!resolved || /(?:avatar|gravatar|favicon|(?:^|[/_.-])logo(?:[/_.-]|$)|tracking|pixel|spacer|icon(?:[/_.-]|$)|badge|emoji)/i.test(resolved+' '+hint))return;
  if ((width && width<120) || (height && height<70)) return;
  if(width && height && (width/height>4 || height/width>4))return;
  return resolved;
}
export function firstBodyImage(html: string, base: string): string | undefined {
  const doc=new DOMParser().parseFromString(html,'text/html');
  for(const img of doc.querySelectorAll('img')){
    const url=imageCandidate(img.getAttribute('src')??img.getAttribute('data-src')??'',base,Number(img.getAttribute('width')),Number(img.getAttribute('height')),img.getAttribute('alt')??'');
    if(url)return url;
  }
}
export function extractPage(html: string, url: string): {html?:string; cover?:string} {
  const doc=new DOMParser().parseFromString(html,'text/html');
  const base=doc.createElement('base');base.href=url;doc.head.prepend(base);
  const cover=imageCandidate(doc.querySelector('meta[property="og:image"],meta[name="twitter:image"]')?.getAttribute('content')??'',url);
  const article=new Readability(doc,{charThreshold:160,maxElemsToParse:30000}).parse();
  return {html:article?.content && article.textContent && article.textContent.trim().length>=160?safeHtml(article.content,url):undefined,cover};
}
/** Metadata only: preview discovery must not run Readability or mutate saved article bodies. */
export function pageCover(html:string,url:string):string|undefined {
  const doc=new DOMParser().parseFromString(html,'text/html');
  for(const meta of doc.querySelectorAll('meta[property="og:image"],meta[name="twitter:image"],meta[name="twitter:image:src"]')){
    const cover=imageCandidate(meta.getAttribute('content')??'',url);if(cover)return cover;
  }
  return firstBodyImage(html,url);
}
export function sameImage(a:string,b:string):boolean {
  if(a===b)return true;
  const wraps=(target:string,original:string)=>{
    try{const u=new URL(target);return decodeURIComponent(u.pathname).endsWith('/'+original)||[...u.searchParams.values()].some(value=>value===original);}catch{return false;}
  };
  return wraps(a,b)||wraps(b,a);
}
export function markdownFromHtml(html: string, base: string): string {
  const converter=new TurndownService({headingStyle:'atx',codeBlockStyle:'fenced',bulletListMarker:'-'});
  return converter.turndown(safeHtml(html,base));
}
