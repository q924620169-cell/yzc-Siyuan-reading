export interface Source {
  id: string; url: string; title: string; group: string; groups?:string[]; tags: string[];
  etag?: string; modified?: string; fetchedAt?: number; error?: string;
  type?: string; failures?: number; retryAfter?: number;
  api?:{serviceId:string;sourceKey:string;listUrl?:string;cursor?:string;platform?:string;category?:string};
}
/** Legacy group remains a first-membership compatibility mirror; groups is authoritative when present. */
export function sourceGroups(source:Pick<Source,'group'|'groups'>):string[]{return [...new Set((source.groups??(source.group?[source.group]:[])).map(g=>g.trim()).filter(Boolean))];}
export function setSourceGroups(source:Source,groups:string[]):void{source.groups=[...new Set(groups.map(g=>g.trim()).filter(Boolean))];source.group=source.groups[0]??'未分组';}
export function inGroup(source:Source,group:string):boolean{return sourceGroups(source).includes(group)||(group==='未分组'&&sourceGroups(source).length===0);}
export interface SourceRecord { sourceId:string; guid:string; url:string; discoveredAt:number; fetchedAt:number }
export interface ContentFetch { state:'pending'|'available'|'failed'; attempts:number; checkedAt?:number; retryAfter?:number; error?:string }
/** Optional post-processing only. Results always belong to an exact original version. */
export interface Translation { state:'disabled'|'pending'|'ready'|'failed'|'stale'; sourceVersion?:string; title?:string; summary?:string; html?:string; error?:string }
export interface Article {
  id: string; sourceId: string; guid: string; url: string; title: string; author: string;
  published: number; summary: string; tags: string[]; cover?: string; coverOrigin?: 'feed' | 'page' | 'body';
  later: boolean; importedId?: string; contentKind: 'feed' | 'extracted' | 'summary'; sourceIds?:string[];
  originalUrl?:string; canonicalUrl?:string; urlAliases?:string[]; sourceType?:string; records?:SourceRecord[]; fetchedAt?:number;
  fingerprint?:string; contentFetch?:ContentFetch; contentVersion?:string; translation?:Translation;
  savedKind?:Article['contentKind'];
  previewCover?:string; coverFetch?:ContentFetch;
  api?:{serviceId:string;entryId:string;version?:string};titleZh?:string;summaryZh?:string;
}
export interface ApiVersion {html?:string;title?:string;state:string;checkedAt:number;retryAt:number}
export interface ArticleBody { html: string; kind: Article['contentKind']; checkedPage?: boolean;apiChoice?:'rewrite'|'translation'|'original';api?:{version?:string;serviceName:string;originalKind:string;rewrite?:ApiVersion;translation?:ApiVersion;error?:string;checkedAt:number} }
export interface ImportRecord { notebook: string; path: string; documentId?: string; completed?: boolean; coverAsset?:string; language?:'zh-CN' }
export interface CacheEntry { path: string; bytes: number; used: number; url: string }
export interface ReadingHistory {articleId:string;openedAt:number;sourceId:string;title:string;url:string}
export interface RssState {
  version: 2; sources: Source[]; articles: Article[]; groups: string[]; tags: string[];
  imports: Record<string, ImportRecord>; cache: Record<string, CacheEntry>;
  history:ReadingHistory[];
  settings: { refreshMinutes: number; cacheMB: number; retentionDays: number; inboxNotebook: string };
}
export interface Filter { mode: 'all' | 'later' | 'history' | 'group' | 'source' | 'custom'; value?: string; sourceIds: string[]; tags: string[] }
export const allFilter = (): Filter => ({mode:'all',sourceIds:[],tags:[]});
export const initialState = (): RssState => ({
  version:2,sources:[],articles:[],groups:[],tags:[],imports:{},cache:{},history:[],
  settings:{refreshMinutes:30,cacheMB:100,retentionDays:90,inboxNotebook:''},
});
export function normalizeHistory(raw:unknown,articles:Article[]):ReadingHistory[]{
  const available=new Map(articles.map(a=>[a.id,a])),seen=new Set<string>();
  if(!Array.isArray(raw))return[];
  return raw.filter((h):h is ReadingHistory=>!!h&&typeof h.articleId==='string'&&typeof h.openedAt==='number'&&Number.isFinite(h.openedAt)&&h.openedAt>0&&available.has(h.articleId)).sort((a,b)=>b.openedAt-a.openedAt).filter(h=>{if(seen.has(h.articleId))return false;seen.add(h.articleId);return true;}).slice(0,20).map(h=>{const a=available.get(h.articleId)!;return{articleId:h.articleId,openedAt:h.openedAt,sourceId:a.sourceId,title:a.title,url:a.url};});
}
export function readState(raw: unknown): RssState {
  if (raw == null || raw === '') return initialState();
  const s = raw as RssState;
  if (![1,2].includes(s.version) || !Array.isArray(s.sources) || !Array.isArray(s.articles) ||
      !Array.isArray(s.groups) || !Array.isArray(s.tags) || !s.settings || !s.imports || !s.cache)
    throw new Error('本地 RSS 数据格式无法识别，已停止写入以保留原数据。');
  if (s.sources.some(x=>!x.id || !x.url || !Array.isArray(x.tags)||(x.groups!==undefined&&(!Array.isArray(x.groups)||x.groups.some(g=>typeof g!=='string')))) || s.articles.some(x=>!x.id || !x.sourceId || !Array.isArray(x.tags)))
    throw new Error('本地 RSS 数据损坏，未重置数据。');
  const {combinedLayout:_retiredLayout,...settings}=s.settings as RssState['settings'] & {combinedLayout?:unknown};
  return {...s,version:2,history:normalizeHistory(s.history,s.articles),sources:s.sources.map(x=>({...x,type:x.type??'rss',groups:sourceGroups(x)})),
    articles:s.articles.map(a=>({...a,canonicalUrl:a.canonicalUrl??canonicalUrl(a.url),sourceType:a.sourceType??'rss',
      sourceIds:a.sourceIds??[a.sourceId],records:a.records??(a.sourceIds??[a.sourceId]).map(sourceId=>({
        sourceId,guid:sourceId===a.sourceId?a.guid:'',url:a.url,discoveredAt:a.fetchedAt??0,fetchedAt:a.fetchedAt??0})),
      contentFetch:a.contentFetch??{state:a.contentKind==='summary'?'pending':'available',attempts:0},
      translation:a.translation??{state:'disabled'}})),settings:{...initialState().settings,...settings}};
}
export function sourceIdsFor(filter: Filter, sources: Source[]): string[] {
  if (filter.mode === 'source') return sources.filter(s=>s.id===filter.value).map(s=>s.id);
  if (filter.mode === 'group') return sources.filter(s=>inGroup(s,filter.value??'')).map(s=>s.id);
  if (filter.mode === 'custom') return filter.sourceIds;
  return sources.map(s=>s.id);
}
export function filterArticles(state: RssState, filter: Filter): Article[] {
  if(filter.mode==='history'){const articles=new Map(state.articles.map(a=>[a.id,a]));return normalizeHistory(state.history,state.articles).map(h=>articles.get(h.articleId)!);}
  const ids=new Set(sourceIdsFor(filter,state.sources));
  const sources=new Map(state.sources.map(s=>[s.id,s]));
  return state.articles.filter(a=>{
    if (!(a.sourceIds??[a.sourceId]).some(id=>ids.has(id)) || (filter.mode==='later' && !a.later)) return false;
    const tags=new Set([...a.tags,...(a.sourceIds??[a.sourceId]).flatMap(id=>sources.get(id)?.tags??[])]);
    return !filter.tags.length||filter.tags.some(t=>tags.has(t));
  }).sort((a,b)=>b.published-a.published || a.id.localeCompare(b.id));
}
export function groupSelection(ids: string[], selected: Set<string>): 'none' | 'partial' | 'all' {
  const count=ids.filter(id=>selected.has(id)).length;
  return count===0?'none':count===ids.length?'all':'partial';
}
export function mergeArticles(existing: Article[], incoming: Article[]): Article[] {
  const map=new Map(existing.map(a=>[a.id,a]));
  for (const a of incoming) {
    const old=map.get(a.id);
    const records=new Map((old?.records??[]).map(r=>[`${r.sourceId}\n${r.guid||r.url}`,r]));
    for(const r of a.records??[]){const key=`${r.sourceId}\n${r.guid||r.url}`;records.set(key,{...r,discoveredAt:records.get(key)?.discoveredAt??r.discoveredAt});}
    const changed=!!old?.contentVersion && !!a.contentVersion && old.contentVersion!==a.contentVersion;
    map.set(a.id,old?{...old,...a,sourceId:old.sourceId,records:[...records.values()],
      urlAliases:[...new Set([...(old.urlAliases??[]),old.canonicalUrl||canonicalUrl(old.url),a.canonicalUrl||canonicalUrl(a.url)].filter(Boolean))],
      sourceIds:[...new Set([...(old.sourceIds??[old.sourceId]),...(a.sourceIds??[a.sourceId])])],
      tags:[...new Set([...old.tags,...a.tags])],later:old.later,importedId:old.importedId,
      contentKind:quality(old.contentKind)>quality(a.contentKind)?old.contentKind:a.contentKind,
      contentFetch:a.contentKind==='summary'?old.contentFetch:a.contentFetch??old.contentFetch,
      translation:changed && old.translation?.state==='ready'?{...old.translation,state:'stale'}:old.translation??a.translation,
      cover: a.coverOrigin==='feed'?a.cover:old.cover??a.cover,
      previewCover:a.coverOrigin==='feed'&&a.cover!==old.cover?undefined:old.previewCover,
      coverFetch:a.coverOrigin==='feed'&&a.cover!==old.cover?undefined:old.coverFetch,
      coverOrigin:a.coverOrigin==='feed'?'feed':old.coverOrigin??a.coverOrigin}:a);
  }
  return [...map.values()].sort((a,b)=>b.published-a.published);
}
export const quality=(kind:Article['contentKind']):number=>kind==='summary'?0:kind==='feed'?1:2;
/** Source GUID first; URL bridges sources. Fingerprints are exact and source-scoped. */
export function findIdentity(existing:Article[],candidate:Article):Article|undefined {
  const byGuid=candidate.guid && existing.find(a=>(a.records??[{sourceId:a.sourceId,guid:a.guid}]).some(r=>r.sourceId===candidate.sourceId&&r.guid===candidate.guid));
  if(byGuid)return byGuid;
  const url=candidate.canonicalUrl||canonicalUrl(candidate.url);
  if(url)return existing.find(a=>(a.canonicalUrl||canonicalUrl(a.url))===url || a.urlAliases?.includes(url) || a.records?.some(r=>canonicalUrl(r.url)===url));
  if(candidate.guid)return;
  return existing.find(a=>!a.url&&!a.guid&&a.sourceId===candidate.sourceId&&a.fingerprint===candidate.fingerprint&&!!a.fingerprint);
}
export function canonicalUrl(value: string, base?: string): string {
  if(!value.trim())return '';
  try {
    const u=new URL(value,base);
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password) return '';
    u.hash='';
    for (const key of [...u.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) u.searchParams.delete(key);
    return u.href;
  } catch { return ''; }
}
export async function digest(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function chineseDate(value:number,now=Date.now()):string {
  if(!value||!Number.isFinite(value))return '发布时间未知';
  const date=new Date(value),today=new Date(now);if(!Number.isFinite(date.getTime()))return '发布时间未知';
  const day=(d:Date)=>Date.UTC(d.getFullYear(),d.getMonth(),d.getDate());
  const distance=(day(today)-day(date))/86400_000;
  if(distance>=0&&distance<=2)return `${['今天','昨天','前天'][distance]} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
  return `${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日`;
}
export function displayIdentity(source:string,author:string):string[]{
  const short=(s:string)=>s.trim().replace(/\s*(?:[—–|:·-]\s*)?(?:articles?|posts?|rss|feed)\s*$/i,'').trim()||s.trim();
  const key=(s:string)=>s.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
  const name=short(source),writer=short(author);return [name,...writer&&key(writer)!==key(name)?[writer]:[]].filter(Boolean);
}
