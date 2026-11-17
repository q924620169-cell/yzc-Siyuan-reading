import {safeHtml} from './content';
import {digest,type Article,type ArticleBody} from './model';
import {withWorkspaceLock,type Repository} from './storage';
import type {Kernel,Remote} from './kernel';

export const TRANSLATION={model:'Index-Translate-35B-A3B',endpoint:'https://index-translate.bilibili.com/v1/chat/completions',target:'zh-Hans',rules:3} as const;
export interface Unit {id:string;text:string;source:string;tokens:string[];markupTokens?:number[];markup?:boolean;html?:string;hash?:string}
export interface TranslationPlan {id:string;fingerprint:string;html:string;title:string;units:Unit[];needed:boolean}
export interface TranslationCache {version:1;key:string;articleId:string;fingerprint:string;model:string;target:string;rules:number;parts:Record<string,string>;updated:number;state:'partial'|'ready'|'failed';error?:string}
export interface TranslationResult {plan:TranslationPlan;cache:TranslationCache}
export interface TranslationProgress {done:number;total:number}
export const escapeText=(text:string):string=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const excluded='pre,code,kbd,samp,math,script,style,[data-type="inline-math"],[data-type="math"]';
const blockTags='p,h1,h2,h3,h4,h5,h6,figcaption,dt,dd';
export const needsTranslation=(text:string):boolean=>{const latin=(text.match(/[a-zA-Z]/g)??[]).length,han=(text.match(/[\u3400-\u9fff]/g)??[]).length;return latin>=10&&han<latin*.35;};
function splitText(text:string):string[]{
  const sentences=[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(text)].map(s=>s.segment),out:string[]=[];let current='';
  for(const sentence of sentences){
    if(current.length+sentence.length>950&&current){out.push(current);current='';}
    if(sentence.length<=950){current+=sentence;continue;}
    // Unusually long sentences split at word boundaries; do not cut ordinary sentences.
    for(const word of sentence.match(/\S+\s*|\s+/g)??[]){if(current.length+word.length>950&&current){out.push(current);current='';}current+=word;}
  }
  if(current)out.push(current);return out;
}
export function unit(id:string,text:string):Unit{
  const tokens:string[]=[];
  const source=text.trim().replace(/https?:\/\/[^\s<>]+|`[^`]+`|\$(?:\\[a-zA-Z]+|[^$\n]{0,80}[=^+*/_\\][^$\n]{0,80}|[a-zA-Z0-9]+)\$(?!\d)|\\\([^]*?\\\)|\b\w+_\w+\b|\b[a-z]+[A-Z][a-zA-Z]*\b|\b[A-Z]{2,}[A-Z0-9]*\b|[+-]?\d+(?:[.,:/-]\d+)*%?/g,value=>{const token=`⟦P${tokens.length}⟧`;tokens.push(value);return token;});
  return{id,text,source,tokens};
}
export async function legacyPlan(article:Article,body:ArticleBody):Promise<TranslationPlan>{
  const clean=safeHtml(body.html,article.url),fingerprint=await digest(article.title+'\n'+clean),doc=new DOMParser().parseFromString(clean,'text/html');
  // Normalize loose inline runs in list/table/container blocks, preserving every node.
  for(const parent of [doc.body,...doc.body.querySelectorAll('div,li,td,th,blockquote')]){
    let run:Node[]=[];const flush=()=>{if(run.some(n=>(n.textContent??'').trim())){const p=doc.createElement('div');p.dataset.rssRun='';parent.insertBefore(p,run[0]);run.forEach(n=>p.append(n));}run=[];};
    for(const child of [...parent.childNodes]){if(child.nodeType===1&&(child as Element).matches('p,div,ul,ol,li,table,blockquote,pre,h1,h2,h3,h4,h5,h6,figure,hr'))flush();else run.push(child);}flush();
  }
  const needed=needsTranslation(article.title+' '+(doc.body.textContent??'')),units:Unit[]=[];
  if(needed&&/[a-zA-Z]{2}/.test(article.title))units.push(...splitText(article.title).map((t,i)=>unit(`title-${i}`,t)));
  const blocks=new Map<Element,string>();let index=0;
  const walker=doc.createTreeWalker(doc.body,4),nodes:Text[]=[];while(walker.nextNode())nodes.push(walker.currentNode as Text);
  for(const node of nodes){const parent=node.parentElement;if(!parent||parent.closest(excluded)||!/[a-zA-Z]{2}/.test(node.data))continue;
    const block=parent.closest(blockTags+', [data-rss-run]')??parent;
    if(!blocks.has(block)){const key=`b${blocks.size}`;blocks.set(block,key);block.setAttribute('data-rss-block',key);}
    const key=`n${index++}`,span=doc.createElement('span');span.dataset.rssText=key;node.replaceWith(span);span.append(node);
    const latin=(node.data.match(/[a-zA-Z]/g)??[]).length,han=(node.data.match(/[\u3400-\u9fff]/g)??[]).length;
    if(needed&&han<latin*.35)units.push(...splitText(node.data).map((t,i)=>unit(`${key}-${i}`,t)));
  }
  return{id:article.id,fingerprint,html:doc.body.innerHTML,title:article.title,units,needed:needed&&units.length>0};
}
export function translationBatches(units:Unit[]):Unit[][]{
  const batches:Unit[][]=[];let batch:Unit[]=[],size=0;
  for(const u of units){if(batch.length&&(size+u.source.length>1200||batch.length>=12)){batches.push(batch);batch=[];size=0;}batch.push(u);size+=u.source.length;}
  if(batch.length)batches.push(batch);return batches;
}
export class PartialTranslationError extends Error {
  constructor(message:string,readonly parts:Record<string,string>,readonly units:Unit[]){super(message);}
}
export function decodeTranslation(raw:string,units:Unit[]):Record<string,string>{
  if(/<\/?think\b/i.test(raw))throw Error('翻译接口返回了分析内容。');
  let text=raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1'),value:unknown;
  try{value=JSON.parse(text);}catch{
    if(!text.startsWith('{\\"'))throw Error('翻译格式不正确。');
    try{value=JSON.parse(JSON.parse('"'+text.replace(/\r?\n/g,'\\n')+'"'));}catch{throw Error('翻译格式不正确。');}
  }
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{throw Error('翻译格式不正确。');}}
  if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).length!==units.length)throw Error('翻译块数量不匹配。');
  const result:Record<string,string>={},invalid:Unit[]=[];let error='';
  for(const u of units){try{const entry=(value as Record<string,unknown>)[u.id];if(typeof entry!=='string'||!entry.trim()||entry.length>u.text.length*8+300)throw Error(`翻译块 ${u.id} 为空或异常。`);let translated=entry;
    if(u.markup){const order=[...translated.matchAll(/⟦P(\d+)⟧/g)].map(m=>Number(m[1])).filter(i=>u.markupTokens?.includes(i));if(JSON.stringify(order)!==JSON.stringify(u.markupTokens??[]))throw Error('翻译改变了内联结构顺序。');translated=escapeText(translated);}
    for(let i=0;i<u.tokens.length;i++){const marker=`⟦P${i}⟧`;if(translated.split(marker).length!==2)throw Error(`翻译改变了代码、数字或链接占位（${u.id}）。`);translated=translated.replace(marker,u.markup&&!(u.markupTokens??[]).includes(i)?escapeText(u.tokens[i]):u.tokens[i]);}
    if(/⟦P\d+⟧/.test(translated))throw Error('翻译包含未知占位。');
    if(u.markup&&u.html){const source=new DOMParser().parseFromString(u.html,'text/html'),target=new DOMParser().parseFromString(translated,'text/html'),expected=[...source.querySelectorAll('strong,b,em,i')],actual=[...target.querySelectorAll('strong,b,em,i')];if(expected.some((el,i)=>el.textContent?.trim()&&!actual[i]?.textContent?.trim()))throw Error('翻译将原文强调内容移出了强调标记。');}
    if((u.source.replace(/⟦P\d+⟧/g,'').match(/[a-zA-Z]/g)??[]).length>60&&!/[\u3400-\u9fff]/.test(translated))throw Error('段落未返回中文译文。');
    result[u.id]=(u.text.match(/^\s*/)?.[0]??'')+translated.trim()+(u.text.match(/\s*$/)?.[0]??'');
  }catch(e){invalid.push(u);error=(e as Error).message;}}
  if(invalid.length)throw new PartialTranslationError(error,result,invalid);return result;
}
export function legacyContent(result:TranslationResult,bilingual=false):{title:string;html:string}{
  const {plan,cache}=result,doc=new DOMParser().parseFromString(plan.html,'text/html'),original=new Map<string,Element>();
  doc.querySelectorAll('[data-rss-block]').forEach(el=>original.set(el.getAttribute('data-rss-block')!,el.cloneNode(true) as Element));
  for(const span of doc.querySelectorAll('[data-rss-text]')){const key=span.getAttribute('data-rss-text')!,parts=plan.units.filter(u=>u.id.startsWith(key+'-'));if(parts.length)span.textContent=parts.map(u=>cache.parts[u.id]??u.text).join('');}
  if(bilingual)for(const [id,source] of original){const translated=doc.querySelector(`[data-rss-block="${id}"]`);if(!translated)continue;
    // Images stay once in their original place; only translated text is repeated.
    const clone=translated.cloneNode(true) as Element;clone.querySelectorAll('img').forEach(img=>img.remove());clone.removeAttribute('data-rss-block');clone.classList.add('rss-translated-block');
    const pair=doc.createElement('div');pair.dataset.rssBlock=id;source.removeAttribute('data-rss-block');source.classList.add('rss-original-block');translated.replaceWith(pair);pair.append(source,clone);
  }
  const titleUnits=plan.units.filter(u=>u.id.startsWith('title-'));return{title:titleUnits.length?titleUnits.map(u=>cache.parts[u.id]??u.text).join(''):plan.title,html:doc.body.innerHTML};
}
export class TranslationError extends Error {constructor(message:string,readonly retryable=true,readonly delay=0){super(message);}}
export function completionText(body:string):string{
  if(body.length>2_000_000)throw new TranslationError('翻译响应超过大小上限。');
  if(body.trimStart().startsWith('data:')){
    let content='',finish='',done=false;
    for(const line of body.split(/\r?\n/)){
      if(!line.startsWith('data:'))continue;const text=line.slice(5).trim();if(text==='[DONE]'){done=true;continue;}
      let data;try{data=JSON.parse(text);}catch{throw new TranslationError('翻译流格式无法识别。');}
      if(data.error)throw new TranslationError('翻译服务中断。');const choice=data.choices?.[0];
      if(choice?.delta?.reasoning_content||choice?.delta?.reasoning)throw new TranslationError('翻译接口返回了分析内容。');
      if(typeof choice?.delta?.content==='string')content+=choice.delta.content;
      if(choice?.finish_reason)finish=choice.finish_reason;
    }
    if(!done||finish!=='stop'||!content)throw new TranslationError('翻译输出未完整结束。');return content;
  }
  let data;try{data=JSON.parse(body);}catch{throw new TranslationError('翻译服务返回格式无法识别。');}
  const choice=data.choices?.[0];if(choice?.finish_reason!=='stop')throw new TranslationError('翻译输出未完整结束。');
  if(typeof choice.message?.content!=='string')throw new TranslationError('翻译服务没有返回译文。');return choice.message.content;
}
export class IndexTranslator {
  constructor(private api:Kernel,private signal?:AbortSignal){}
  async translate(units:Unit[]):Promise<Record<string,string>>{
    // A leading comma in an inline text run makes this model omit the JSON opening quote.
    // Keep that punctuation locally, rather than accepting or repairing malformed model JSON.
    const prefixes=new Map(units.map(u=>[u.id,u.source.match(/^[,;:]\s*/)?.[0]??'']));
    const legend=Object.fromEntries(units.filter(u=>u.markup).map(u=>[u.id,Object.fromEntries((u.markupTokens??[]).map(i=>{const tag=u.tokens[i].match(/^<(\/?)(strong|b|em|i|a)\b/i);return tag?[`⟦P${i}⟧`,({strong:'加粗',b:'加粗',em:'斜体',i:'斜体',a:'链接'} as Record<string,string>)[tag[2].toLowerCase()]+(tag[1]?'结束':'开始')]:null;}).filter((v):v is [string,string]=>v!==null))]));
    const payload={model:TRANSLATION.model,messages:[{role:'user',content:'请将下面 JSON 对象的英文 value 翻译为自然、准确的简体中文，key 不变，⟦P数字⟧ 占位符不变。保留原意和语气，不增删总结，各项不合并，术语保持一致。每个value是完整段落，请结合整段语境翻译，不能把格式内外的文字各自孤立翻译。加粗/斜体标记只包住原文所强调内容对应的中文词语，不扩大到相邻介词、助词或连接语。例如 For 加粗authors结束 应译为 对于 加粗作者结束 来说，不能把来说放入加粗。不要增加原文没有的强调，不要输出空强调。保留标记顺序，链接地址及代码等受保护内容不变。以下是标记含义，仅供理解不要输出：'+JSON.stringify(legend)+'。只输出原JSON键到中文段落的合法JSON，不解释，不分析。\n'+JSON.stringify(Object.fromEntries(units.map(u=>[u.id,u.source.slice(prefixes.get(u.id)!.length)])))}],temperature:0,max_tokens:2048,stream:true,chat_template_kwargs:{enable_thinking:false}};
    const r=await this.api<Remote>('/api/network/forwardProxy',{url:TRANSLATION.endpoint,method:'POST',contentType:'application/json',headers:[{'User-Agent':'Index-Translate-Client/1.0'}],timeout:90000,payload,payloadEncoding:'json',responseEncoding:'text'},this.signal);
    if(r.status!==200){const retry=Object.entries(r.headers??{}).find(([k])=>k.toLowerCase()==='retry-after')?.[1]?.[0],seconds=Number(retry),delay=Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(retry??'')-Date.now());throw new TranslationError(`翻译服务返回 HTTP ${r.status}${r.status===429?'，请稍后重试':''}。`,r.status===429||r.status>=500,Math.min(60000,Math.max(r.status===429?5000:0,delay||0)));}
    const restore=(decoded:Record<string,string>)=>{for(const u of units)if(decoded[u.id]&&prefixes.get(u.id)&&!/^\s*[,，;；:：]/.test(decoded[u.id])){const space=decoded[u.id].match(/^\s*/)?.[0]??'',mark=({',':'，',';':'；',':':'：'} as Record<string,string>)[prefixes.get(u.id)![0]];decoded[u.id]=space+mark+decoded[u.id].slice(space.length);}return decoded;};
    try{return restore(decodeTranslation(completionText(r.body),units));}catch(error){if(error instanceof PartialTranslationError)restore(error.parts);throw error;}
  }
}
