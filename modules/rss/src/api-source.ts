import {canonicalUrl,digest,type Article,type ArticleBody,type Source,type ApiVersion} from './model';
import {plain,safeHtml} from './content';
import type {RemoteClient} from './kernel';
import type {Repository} from './storage';
export interface Mapping {id:string;title:string;url:string;author?:string;published?:string;summary?:string;body?:string;cover?:string;titleZh?:string;summaryZh?:string;version?:string}
export interface Endpoint {path:string;items?:string;body?:string;title?:string;status?:string;stale?:string;format?:'html'|'markdown'|'text';blocks?:string;blockHtml?:string;blockText?:string}
export interface ApiServiceConfig {
 id:string;name:string;baseUrl:string;list:Endpoint;fields:Mapping;detail?:Endpoint;directory?:Endpoint;
 directoryFields?:{id:string;name:string;category?:string;platform?:string};rewrite?:Endpoint;translation?:Endpoint;
 params?:Record<string,string>;pagination?:{mode:'cursor'|'page'|'offset';param:string;sizeParam?:string;size:number;next?:string;hasMore?:string;maxPages?:number;start?:number};
}
export const qmreader=():ApiServiceConfig=>({id:'qmreader',name:'QMReader',baseUrl:'https://rss.qiaomu.ai',list:{path:'/api/sources/{source}/entries',items:'entries'},fields:{id:'id',title:'title',url:'link',author:'author',published:'published',summary:'summary',body:'content',cover:'image',titleZh:'titleZh',summaryZh:'summaryZh',version:'contentHash'},detail:{path:'/api/entry/{id}',items:'entry'},directory:{path:'/api/sources',items:'sources'},directoryFields:{id:'id',name:'name',category:'category'},rewrite:{path:'/api/entry/{id}/rewrite',body:'rewrite.body',title:'rewrite.title',status:'status',stale:'rewrite.stale',format:'markdown'},translation:{path:'/api/entry/{id}/translation',blocks:'translation.content',blockHtml:'targetHtml',blockText:'target',status:'status',stale:'translation.stale',format:'html'},pagination:{mode:'cursor',param:'cursor',sizeParam:'limit',size:40,next:'nextCursor',hasMore:'hasMore',maxPages:1}});
/** A bounded property path, never an expression or executable template. */
export function field(value:unknown,path?:string):any {if(!path)return value;let v:any=value;for(const key of path.split('.')){if(!/^[\w-]+$/.test(key)||['__proto__','constructor','prototype'].includes(key))return undefined;v=v!=null&&Object.prototype.hasOwnProperty.call(v,key)?v[key]:undefined;}return v;}
const str=(v:unknown)=>typeof v==='string'||typeof v==='number'?String(v):'';
export function apiText(value:string,format='html',base=''):string {
 if(!value.trim())return '';
 if(format==='markdown'){
  const lute=(globalThis as any).Lute?.New?.();if(lute)return safeHtml(lute.Md2HTML(value),base);
  // Conservative offline fallback when the host Markdown renderer is absent.
  return safeHtml(value.split(/\n\s*\n/).map(p=>'<p>'+p.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')+'</p>').join(''),base);
 }
 return safeHtml(format==='text'?value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').split(/\n\s*\n/).map(p=>'<p>'+p+'</p>').join(''):value,base);
}
export function validateApi(c:ApiServiceConfig):void {
 if(!c||!c.id||!c.name||!canonicalUrl(c.baseUrl)||!c.list?.path||!c.fields?.id||!c.fields.title||!c.fields.url)throw Error('API 配置需要服务 ID、名称、Base URL、列表路径和 id/title/url 映射。');
 if(!/^[\w-]{1,80}$/.test(c.id))throw Error('服务 ID 仅支持字母、数字、下划线和短横线。');
 for(const ep of[c.list,c.directory,c.detail,c.rewrite,c.translation])if(ep){const u=new URL(ep.path.replace(/\{\w+\}/g,'test'),c.baseUrl);if(u.origin!==new URL(c.baseUrl).origin||!canonicalUrl(u.href))throw Error('API 接口必须与 Base URL 同源，避免认证信息泄露。');}
 if(c.pagination&&(!['cursor','page','offset'].includes(c.pagination.mode)||!Number.isInteger(c.pagination.size)||c.pagination.size<1||c.pagination.size>200))throw Error('分页大小须为 1–200，模式须为 cursor/page/offset。');
}
export class ApiSources {
 constructor(readonly repo:Repository,readonly remote:RemoteClient){}
 async services():Promise<ApiServiceConfig[]>{return await this.repo.io.load('api-services.json') as ApiServiceConfig[]??[];}
 async config(id:string):Promise<ApiServiceConfig>{const c=(await this.services()).find(c=>c.id===id);if(!c)throw Error('此订阅引用的 API 服务已删除，请重新配置服务。');validateApi(c);return c;}
 async save(c:ApiServiceConfig,headers?:Record<string,string>):Promise<void>{validateApi(c);if(headers&&Object.entries(headers).some(([k,v])=>!/^[-\w]+$/.test(k)||typeof v!=='string'||/[\r\n]/.test(v)))throw Error('请求头格式无效。');if(headers)await this.repo.io.save('api-auth-'+c.id+'.json',headers);const list=await this.services();await this.repo.io.save('api-services.json',[...list.filter(x=>x.id!==c.id),c]);}
 async remove(id:string):Promise<void>{if(this.repo.state.sources.some(s=>s.api?.serviceId===id))throw Error('该服务仍有订阅引用，请先在订阅管理中取消这些订阅。');await this.repo.io.save('api-services.json',(await this.services()).filter(c=>c.id!==id));await this.repo.io.remove('api-auth-'+id+'.json');}
 private url(c:ApiServiceConfig,ep:Endpoint,source='',id=''):URL {const u=new URL(ep.path.replace(/\{source\}/g,encodeURIComponent(source)).replace(/\{id\}/g,encodeURIComponent(id)),c.baseUrl);if(u.origin!==new URL(c.baseUrl).origin||!canonicalUrl(u.href))throw Error('API 请求地址无效或跨域。');return u;}
 private async get(c:ApiServiceConfig,u:URL):Promise<any>{const h=await this.repo.io.load('api-auth-'+c.id+'.json') as Record<string,string>??{};try{const r=await this.remote.get(u.href,h);const j=JSON.parse(r.body);if(!j||typeof j!=='object'||j.error||j.code&&j.code!==200)throw Error();return j;}catch{throw Error('API 请求失败或返回无效 JSON，请检查服务连接、认证和限流状态。');}}
 async directory(id:string):Promise<{id:string;name:string;category?:string;platform?:string}[]>{const c=await this.config(id);if(!c.directory)return[];const items=field(await this.get(c,this.url(c,c.directory)),c.directory.items);if(!Array.isArray(items))throw Error('来源目录映射未找到数组。');const f=c.directoryFields??{id:'id',name:'name'};return items.slice(0,2000).filter(x=>x.enabled!==false).map(x=>({id:str(field(x,f.id)),name:str(field(x,f.name)),category:str(field(x,f.category)),platform:str(field(x,f.platform))})).filter(x=>x.id&&x.name);}
 async listing(source:Source,more=false):Promise<{title:string;items:{article:Article;body:ArticleBody}[];cursor?:string}> {
  const c=await this.config(source.api!.serviceId),p=c.pagination,items:{article:Article;body:ArticleBody}[]=[],seen=new Set<string>();let cursor=more?source.api!.cursor:undefined,next:string|undefined;
  if(more&&!cursor)return{title:source.title,items};
  for(let page=0;page<Math.min(10,p?.maxPages??1);page++){
   const u=this.url(c,source.api!.listUrl?{path:source.api!.listUrl}:c.list,source.api!.sourceKey);for(const [k,v]of Object.entries(c.params??{}))u.searchParams.set(k,v.replaceAll('{source}',source.api!.sourceKey));
   if(p){if(p.sizeParam)u.searchParams.set(p.sizeParam,String(p.size));if(cursor)u.searchParams.set(p.param,cursor);else if(p.mode!=='cursor')u.searchParams.set(p.param,String(p.start??(p.mode==='page'?1:0)));}
   const data=await this.get(c,u),rows=field(data,c.list.items);if(!Array.isArray(rows))throw Error('文章列表映射未找到数组。');
   for(const row of rows.slice(0,200)){const f=c.fields,key=str(field(row,f.id)),url=canonicalUrl(str(field(row,f.url))),title=str(field(row,f.title));if(!key||!title)continue;
    const id=await digest('api:'+source.id+':'+key),html=apiText(str(field(row,f.body)),c.list.format,url),rawDate=field(row,f.published),published=typeof rawDate==='number'?(rawDate<1e12?rawDate*1000:rawDate):Date.parse(rawDate)||0;
    items.push({article:{id,sourceId:source.id,sourceType:'api',guid:key,url,title,author:str(field(row,f.author))||source.title,published,summary:plain(str(field(row,f.summary))),titleZh:str(field(row,f.titleZh)),summaryZh:str(field(row,f.summaryZh)),tags:[],later:false,contentKind:html?'feed':'summary',cover:canonicalUrl(str(field(row,f.cover)))||undefined,coverOrigin:'feed',api:{serviceId:c.id,entryId:key,version:str(field(row,f.version))}},body:{html:html||apiText(str(field(row,f.summary)),'text',url),kind:html?'feed':'summary',checkedPage:true}});
   }
   next=p?.mode==='cursor'?str(field(data,p.next))||undefined:p&&rows.length>=p.size?String(Number(cursor??p.start??(p.mode==='page'?1:0))+(p.mode==='offset'?p.size:1)):undefined;
   if(p?.hasMore&&field(data,p.hasMore)===false)next=undefined;if(!next)break;if(seen.has(next)||next===cursor){next=undefined;break;}seen.add(next);cursor=next;
  }return{title:source.title,items,cursor:next};
 }
 async body(a:Article,cached:ArticleBody):Promise<ArticleBody>{
  const c=await this.config(a.api!.serviceId),now=Date.now();if(cached.api&&cached.api.version===a.api?.version&&now-cached.api.checkedAt<(cached.api.rewrite?.state==='ready'?7*86400000:300000))return cached;
  const out:ArticleBody={...cached,checkedPage:true,api:{...cached.api,serviceName:c.name,originalKind:'订阅正文（完整度由来源决定）',version:a.api?.version,error:undefined,checkedAt:now}};
  try{if(c.detail){const j=field(await this.get(c,this.url(c,c.detail,'',a.api!.entryId)),c.detail.items);const html=apiText(str(field(j,c.fields.body)),c.detail.format,a.url);if(html){out.html=html;out.kind='feed';}}}catch{out.api!.error='详情暂不可用，已保留本地正文。';}
  const source=this.repo.state.sources.find(s=>s.id===a.sourceId);if(source?.api?.category==='podcast')out.api!.originalKind='节目简介 / 来源正文，未确认是完整文字稿';
  for(const kind of['rewrite','translation'] as const){const ep=c[kind];if(!ep)continue;const previous=cached.api?.[kind];if(previous&&previous.retryAt>now&&cached.api?.version===a.api?.version){out.api![kind]=previous;continue;}
   let v:ApiVersion;try{const j=await this.get(c,this.url(c,ep,'',a.api!.entryId)),blocks=ep.blocks?field(j,ep.blocks):undefined;
    let raw=str(field(j,ep.body));if(ep.blocks){raw=Array.isArray(blocks)?blocks.map(b=>str(field(b,ep.blockHtml))||apiText(str(field(b,ep.blockText)),'text',a.url)).join(''):'';}
    const status=str(field(j,ep.status)),stale=!!ep.stale&&field(j,ep.stale)===true,usable=!stale&&(!status||['ready','completed','complete','done','success'].includes(status));const candidate=apiText(raw,ep.format,a.url),html=usable&&plain(candidate).trim()?candidate:'',state=stale?'stale':html?'ready':status||'unavailable';v={state,html:html||undefined,title:str(field(j,ep.title)),checkedAt:now,retryAt:now+(html?7*86400000:300000)};
   }catch{v={...previous,state:'network-error',checkedAt:now,retryAt:now+60000};out.api!.error='第三方中文接口请求失败；未将失败视为没有译文，可阅读缓存或原文。';}
   out.api![kind]=v;
  }await this.repo.saveBody(a.id,out);if(a.later)await this.repo.saveSnapshot(a.id,out);return out;
 }
}
