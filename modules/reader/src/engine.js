import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import {sanitizerOptions} from './sanitize.js';
import {ZipReader,BlobReader,TextWriter,BlobWriter,configure} from '@zip.js/zip.js';
import {EPUB} from '../vendor/foliate-js/epub.js';
import '../vendor/foliate-js/view.js';
import {Overlayer} from '../vendor/foliate-js/overlayer.js';
import {decodeText,chapterPattern,stableHash} from './model.js';
export {Overlayer};
configure({useWebWorkers:false});
const md=new MarkdownIt({html:true,linkify:true,typographer:false});
export const sanitize=html=>DOMPurify.sanitize(html,sanitizerOptions(location.origin));
const csp=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data: 'self'; style-src 'unsafe-inline' blob:; font-src blob: data: 'self'; script-src 'none'; connect-src 'none'; form-action 'none'">`;
function secureHTML(html){return sanitize(html).replace(/<head>/i,'<head>'+csp);}
const nameOf=x=>typeof x==='string'?x:Array.isArray(x)?x.map(nameOf).join('、'):x?.name?nameOf(x.name):x?Object.values(x).map(nameOf).join(' / '):'';
export async function parse(file,assets={},links={}){
 const format=file.name.split('.').pop().toLowerCase();if(!['epub','md','txt'].includes(format))throw Error('仅支持 EPUB、MD、TXT');if(!file.size)throw Error('文件内容为空');if(file.size>200*1024*1024)throw Error('V1 单本书籍上限为 200 MB');
 if(format==='epub'){
   const zip=new ZipReader(new BlobReader(file));try{
   const entries=await zip.getEntries();const map=new Map(entries.map(e=>[e.filename,e]));
   if(entries.reduce((sum,e)=>sum+e.uncompressedSize,0)>600*1024*1024||entries.length>20000)throw Error('EPUB 解压规模超过安全上限');
   const rawText=async name=>map.has(name)?map.get(name).getData(new TextWriter()):null;
   const encryption=await rawText('META-INF/encryption.xml');if(encryption){const algorithms=[...encryption.matchAll(/Algorithm\s*=\s*["']([^"']+)/g)].map(m=>m[1]);if(algorithms.some(a=>!['http://www.idpf.org/2008/embedding','http://ns.adobe.com/pdf/enc#RC'].includes(a)))throw Error('此 EPUB 使用不支持的 DRM／加密，无法导入');}
   // Parse metadata/navigation in their original XML namespaces. Sanitize only rendered documents.
   const loadText=rawText;
   const book=await new EPUB({loadText,loadBlob:async(name,type)=>map.has(name)?map.get(name).getData(new BlobWriter(type)):null,getSize:name=>map.get(name)?.uncompressedSize||0}).init();
   book.transformTarget.addEventListener('load',event=>{if(event.detail.isScript)event.detail.allow=false;});
   book.transformTarget.addEventListener('data',event=>{if(['application/xhtml+xml','text/html'].includes(event.detail.type)){event.detail.data=Promise.resolve(event.detail.data).then(secureHTML);event.detail.type='text/html';}});
   if(book.rendition?.layout==='pre-paginated'){book.destroy();throw Error('V1 暂不支持固定版式 EPUB，请使用可重排文本版本');}
   if(!book.sections.length)throw Error('EPUB 中没有可阅读章节');
   const destroy=book.destroy.bind(book);book.destroy=()=>{destroy();void zip.close();};
   return{book,format,title:nameOf(book.metadata?.title)||file.name.replace(/\.[^.]+$/,''),author:nameOf(book.metadata?.author),cover:await book.getCover(),published:Date.parse(book.metadata?.published)||0,warnings:[]};
   }catch(e){await zip.close();throw e;}
 }
 const text=decodeText(await file.arrayBuffer()).replace(/\r\n?/g,'\n');let html;
 if(format==='md')html=md.render(text);else html=text.split(/\n\s*\n/).map(part=>{const lines=part.split('\n').map(l=>l.trim()).filter(Boolean);if(lines.some(l=>chapterPattern.test(l)))return lines.map(line=>{const tag=chapterPattern.test(line)?'h2':'p';return`<${tag}>${md.utils.escapeHtml(line)}</${tag}>`;}).join('\n');return'<p>'+lines.map(md.utils.escapeHtml).join('<br>')+'</p>';}).join('\n');
 const doc=new DOMParser().parseFromString(sanitize(html),'text/html');const toc=[],seen=new Map();
 for(const h of doc.querySelectorAll('h1,h2,h3,h4,h5,h6')){const base=h.id||'h-'+stableHash(h.textContent);const count=seen.get(base)||0;seen.set(base,count+1);h.id=count?base+'-'+count:base;toc.push({label:h.textContent,href:'text#'+h.id,level:Number(h.tagName[1]),subitems:[]});}
 const nested=[],stack=[];for(const item of toc){while(stack.length&&stack.at(-1).level>=item.level)stack.pop();(stack.at(-1)?.subitems||nested).push(item);stack.push(item);}toc.splice(0,toc.length,...nested);
 const warnings=[];for(const img of doc.images){const src=img.getAttribute('src');if(assets[src])img.src=location.origin+'/'+assets[src];else if(!src?.startsWith('data:')){warnings.push(`图片未随书导入：${src}`);img.replaceWith(doc.createTextNode(`[图片：${img.alt||src}]`));}}
 for(const a of doc.querySelectorAll('a[href]')){const href=a.getAttribute('href');if(href.startsWith('#'))a.href='text'+href;else if(links?.[href])a.href='reader-course:'+links[href];else if(assets[href])a.href=location.origin+'/'+assets[href];else if(!/^(https?:|mailto:)/i.test(href)){warnings.push(`附件未随书导入：${href}`);a.removeAttribute('href');}}
 doc.head.insertAdjacentHTML('afterbegin',csp);const serialized='<!doctype html>'+doc.documentElement.outerHTML;let url;
 const book={metadata:{title:(format==='md'?toc[0]?.label:null)||file.name.replace(/\.[^.]+$/,''),language:'zh'},sections:[{id:'text',size:text.length,load:()=>url||=(URL.createObjectURL(new Blob([serialized],{type:'text/html'}))),unload:()=>{},createDocument:async()=>new DOMParser().parseFromString(serialized,'text/html')}],toc,pageList:[],splitTOCHref:href=>href.split('#'),getTOCFragment:(d,id)=>d.getElementById(id),resolveHref:href=>({index:0,anchor:d=>d.getElementById(href.split('#')[1])||d.body}),isExternal:href=>/^(https?:|mailto:|reader-course:)/i.test(href),destroy(){if(url)URL.revokeObjectURL(url);}};
 return{book,format,title:book.metadata.title,author:'',warnings};
}
export async function fingerprint(file){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');}
