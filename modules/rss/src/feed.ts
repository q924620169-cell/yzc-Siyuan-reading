import {canonicalUrl,digest,type Article,type ArticleBody} from './model';
import {plain,safeHtml,firstBodyImage,imageCandidate} from './content';

const children=(el:Element,name:string)=>[...el.children].filter(x=>x.localName===name);
const child=(el:Element,name:string)=>children(el,name)[0];
const text=(el:Element,name:string)=>child(el,name)?.textContent?.trim()??'';
function xml(input:string):Document {
  if(input.length>8_000_000)throw new Error('订阅文件超过 8 MB 上限。');
  if(/<!DOCTYPE|<!ENTITY/i.test(input))throw new Error('不支持含 DTD / 外部实体的订阅文件。');
  const doc=new DOMParser().parseFromString(input,'application/xml');
  if(doc.querySelector('parsererror'))throw new Error('订阅 XML 无法解析。');
  return doc;
}
function elementHtml(el: Element | undefined):string {
  if(!el)return '';
  if(el.getAttribute('type')==='xhtml')return [...el.children].map(n=>new XMLSerializer().serializeToString(n)).join('');
  return el.textContent??'';
}
export async function parseFeed(input:string,feedUrl:string,sourceId:string):Promise<{title:string;items:{article:Article;body:ArticleBody}[]}>{
  const doc=xml(input),root=doc.documentElement;
  const atom=root.localName==='feed';
  const channel=atom?root:child(root,'channel');
  if(!channel)throw new Error('该地址不是 RSS 2.0 / Atom 订阅源。');
  const entries=atom?children(root,'entry'):children(channel,'item');
  const items=await Promise.all(entries.slice(0,1000).map(async el=>{
    const base=el.getAttribute('xml:base')||root.getAttribute('xml:base')||feedUrl;
    const link=atom?children(el,'link').find(x=>!x.getAttribute('rel')||x.getAttribute('rel')==='alternate')?.getAttribute('href')??'':text(el,'link');
    const url=canonicalUrl(link,base),guid=text(el,atom?'id':'guid');
    const title=plain(text(el,'title')) || '无标题文章';
    const published=Date.parse(text(el,atom?'published':'pubDate')||text(el,'updated')||text(el,'date'))||0;
    const encoded=child(el,'encoded'),content=child(el,'content');
    const summaryRaw=elementHtml(child(el,atom?'summary':'description'));
    const bodyRaw=elementHtml(encoded)|| (atom?elementHtml(content):'')||summaryRaw;
    const html=safeHtml(bodyRaw,url||base);
    const kind:Article['contentKind']=(encoded || (atom && content)) && plain(html)?'feed':'summary';
    const author=atom?text(child(el,'author')??child(channel,'author')??el,'name'):text(el,'creator')||text(el,'author');
    const tags=children(el,'category').map(x=>x.getAttribute('term')||x.textContent||'').map(x=>x.trim()).filter(Boolean);
    let cover:string|undefined;
    for(const image of [...el.getElementsByTagNameNS('*','content'),...el.getElementsByTagNameNS('*','thumbnail'),...children(el,'enclosure')]){
      if(image.localName==='content' && image.namespaceURI==='http://www.w3.org/2005/Atom')continue;
      const type=image.getAttribute('type')??'',medium=image.getAttribute('medium');
      if(type && !type.startsWith('image/') && medium!=='image')continue;
      cover=imageCandidate(image.getAttribute('url')??'',base,Number(image.getAttribute('width')),Number(image.getAttribute('height')));
      if(cover)break;
    }
    const feedCover=cover;
    cover??=firstBodyImage(html,url||base);
    const fingerprint=await digest(`${title}\n${author}\n${published}\n${plain(html)}`);
    const identity=url||`${sourceId}:${guid||fingerprint}`;
    const fetchedAt=Date.now();
    const article:Article={id:await digest(identity),sourceId,sourceIds:[sourceId],guid,url,title,author,published,
      summary:plain(summaryRaw||html).slice(0,650),tags,cover,coverOrigin:feedCover?'feed':cover?'body':undefined,
      later:false,contentKind:kind,originalUrl:url?new URL(link,base).href:'',canonicalUrl:url,sourceType:'rss',fingerprint,fetchedAt,
      records:[{sourceId,guid,url,discoveredAt:fetchedAt,fetchedAt}],
      contentFetch:{state:kind==='summary'?'pending':'available',attempts:0},translation:{state:'disabled'}};
    return {article,body:{html,kind}};
  }));
  return {title:plain(text(channel,'title'))||new URL(feedUrl).hostname,items};
}
export function parseOpml(input:string):{url:string;title:string;group:string}[]{
  const doc=xml(input);
  if(doc.documentElement.localName.toLowerCase()!=='opml')throw new Error('请选择 OPML 文件。');
  const map=new Map<string,{url:string;title:string;group:string}>();
  for(const el of doc.querySelectorAll('outline[xmlUrl],outline[xmlurl]')){
    const url=canonicalUrl(el.getAttribute('xmlUrl')||el.getAttribute('xmlurl')||'');
    if(!url)continue;
    const groups:string[]=[];
    for(let parent=el.parentElement?.closest('outline');parent;parent=parent.parentElement?.closest('outline')){
      const name=parent.getAttribute('title')||parent.getAttribute('text');if(name)groups.unshift(name);
    }
    if(!map.has(url))map.set(url,{url,title:el.getAttribute('title')||el.getAttribute('text')||url,group:groups.join(' / ')||'未分组'});
  }
  if(!map.size)throw new Error('OPML 没有有效的 HTTP(S) 订阅地址。');
  return [...map.values()];
}
