import {parseFeed,parseOpml} from './feed';
import {canonicalUrl,type Source} from './model';
import type {Remote,RemoteClient} from './kernel';

export type Discovery=Awaited<ReturnType<typeof parseFeed>>;
export interface SourceAdapter {
  type:string;
  discover(response:Remote,source:Pick<Source,'id'|'url'>):Promise<Discovery>;
}
const rss:SourceAdapter={type:'rss',discover:(response,source)=>parseFeed(response.body,source.url,source.id)};
export class SourceRegistry {
  private adapters=new Map<string,SourceAdapter>();
  constructor(adapters:SourceAdapter[]=[rss]){for(const a of adapters){if(this.adapters.has(a.type))throw Error('重复来源类型');this.adapters.set(a.type,a);}}
  get(type='rss'):SourceAdapter{const a=this.adapters.get(type);if(!a)throw Error(`暂不支持来源类型：${type}`);return a;}
}
export interface SubscriptionCandidate {url:string;title:string;group:string;groups?:string[];existing?:boolean}
export interface SubscriptionPlan {kind:'feed'|'choose'|'opml';candidates:SubscriptionCandidate[]}
/** Read-only preparation: neither cancellation nor feed choice writes a subscription. */
export async function resolveInput(input:string,remote:RemoteClient):Promise<SubscriptionPlan>{
  if(input.length>8_000_000)throw Error('订阅输入超过 8 MB。');
  let text=input.trim(),base='';
  if(!text.startsWith('<')){
    base=canonicalUrl(text);if(!base)throw Error('请输入网站首页、RSS/Atom 或 OPML 地址。');
    text=(await remote.get(base)).body;
  }
  if(/<!DOCTYPE[^>]*(?:SYSTEM|PUBLIC)|<!ENTITY/i.test(text)&&!/<html[\s>]/i.test(text))throw Error('不支持含外部实体的订阅文件。');
  const xml=new DOMParser().parseFromString(text,'application/xml');
  const root=xml.documentElement.localName.toLowerCase();
  if(root==='opml')return{kind:'opml',candidates:parseOpml(text)};
  if(root==='rss'||root==='feed'){
    if(!base)throw Error('RSS 文件需使用原始订阅地址添加。');
    await parseFeed(text,base,'preview');
    return{kind:'feed',candidates:[{url:base,title:'',group:'未分组'}]};
  }
  if(!base)throw Error('无法识别 OPML 文件。');
  const doc=new DOMParser().parseFromString(text,'text/html');
  const links=[...doc.querySelectorAll<HTMLLinkElement>('link[rel~="alternate"][href]')]
    .filter(l=>/^(application\/(rss\+xml|atom\+xml|rdf\+xml)|text\/xml)$/i.test(l.type))
    .map(l=>({url:canonicalUrl(l.getAttribute('href')!,base),title:l.title,group:'未分组'}))
    .filter((l,i,a)=>l.url&&a.findIndex(x=>x.url===l.url)===i).slice(0,10);
  const valid:SubscriptionCandidate[]=[];
  // Only explicitly declared endpoints; bounded requests, no crawling.
  for(const link of links)try{await parseFeed((await remote.get(link.url)).body,link.url,'preview');valid.push(link);}catch{/* Invalid declarations are excluded. */}
  if(!valid.length)throw Error('未找到网站声明的有效 RSS/Atom，请提供直接订阅地址。');
  return{kind:valid.length>1?'choose':'feed',candidates:valid};
}
