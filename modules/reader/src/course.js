// Course indexes contain metadata only. Original bytes and old revisions are immutable assets.
import {nodeID,decodeText,stableHash} from './model.js';
import {inspectPDF,pdfAssetName,pdfStamp,pdfFingerprint} from './pdf.js';
const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'variant'});
export const naturalCompare=(a,b)=>collator.compare(a,b)||(a<b?-1:a>b?1:0);
export function normalizePath(path){const out=[];for(const part of path.replaceAll('\\','/').split('/')){if(!part||part==='.')continue;if(part==='..'){if(!out.length)return null;out.pop();}else out.push(part);}return out.join('/');}
export function relativeTarget(article,href){try{return normalizePath(article.split('/').slice(0,-1).concat(decodeURIComponent(href.split(/[?#]/)[0])).join('/'));}catch{return null;}}
export async function digest(file){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export const articleFormat = article => article.format || 'MD';
const folderFingerprint = (entries,resources) => digest(new Blob([entries.concat(resources).map(e=>e.path+'\0'+e.hash).join('\n')]));
export function courseFormat(articles){
 const formats=new Set(articles.map(articleFormat));
 return formats.size>1?'混合格式':formats.values().next().value||'MD';
}
export async function scanFolder(files,progress=()=>{},old){
 const source=[...files].filter(f=>f.webkitRelativePath),root=source[0]?.webkitRelativePath.split('/')[0];if(!root)throw Error('请选择完整的课程文件夹');
 const entries=[],resources=[],skipped=[],failures=[];
 const hasMarkdown=source.some(file=>/\.md$/i.test(file.name));
 const previous=new Map(old?.articles.map(a=>[a.path,a]));
 for(const [index,file] of source.entries()){
  const path=normalizePath(file.webkitRelativePath.split('/').slice(1).join('/'));
  if(!path)throw Error('课程路径无效');
  const ext=path.split('.').pop().toLowerCase();
  const title=path.split('/').pop().replace(/\.[^.]+$/,'');
  if(ext==='md'){
   if(file.size>20*1024*1024)throw Error('单篇课程文章超过 20 MB：'+path);
   entries.push({path,hash:await digest(file),title,file,format:'MD'});
  }else if(ext==='pdf'){
   try{
    await inspectPDF(file);
    const stamp=await pdfStamp(file),prior=previous.get(path);
    const reusable=prior?.format==='PDF'&&prior.stamp?.size===stamp.size&&prior.stamp.modified===stamp.modified&&prior.stamp.sample===stamp.sample;
    const hash=reusable?prior.hash:await pdfFingerprint(file);
    entries.push({path,hash,title,file,format:'PDF',stamp});
   }catch(error){failures.push({path,error:error.message});}
  }else if(hasMarkdown&&/^(png|jpe?g|webp|gif|svg|avif|bmp)$/.test(ext))resources.push({path,hash:await digest(file),file});
  else skipped.push(path);
  progress(index+1,source.length);
 }
 if(!entries.length)throw Error(failures.length?failures.map(f=>f.path+'：'+f.error).join('\n'):'文件夹内没有 Markdown 或 PDF 文章');
 entries.sort((a,b)=>naturalCompare(a.path,b.path));resources.sort((a,b)=>naturalCompare(a.path,b.path));
 return{root,entries,resources,skipped,failures,fingerprint:await folderFingerprint(entries,resources)};
}
export function planUpdate(scan,old={articles:[]},choices={}){
 const used=new Set(),assigned=new Map(),previous=old.articles||[];
 const claim=(entry,article)=>{if(article&&!used.has(article.id)){used.add(article.id);assigned.set(entry.path,article);return true;}return false;};
 for(const e of scan.entries)claim(e,previous.find(a=>a.path===e.path&&a.hash===e.hash));
 for(const e of scan.entries.filter(e=>!assigned.has(e.path))){const matches=previous.filter(a=>!used.has(a.id)&&a.hash===e.hash);const newCount=scan.entries.filter(x=>!assigned.has(x.path)&&x.hash===e.hash).length;if(matches.length===1&&newCount===1)claim(e,matches[0]);}
 for(const e of scan.entries.filter(e=>!assigned.has(e.path)))claim(e,previous.find(a=>a.path===e.path&&!used.has(a.id)));
 for(const e of scan.entries.filter(e=>!assigned.has(e.path))){if(choices[e.path]){const a=previous.find(a=>a.id===choices[e.path]&&articleFormat(a)===articleFormat(e));if(!claim(e,a))throw Error('每篇旧文章只能匹配一篇相同格式的新文件');}}
 const changes=scan.entries.map(e=>{const prior=assigned.get(e.path);return{...e,id:prior?.id||nodeID(),prior,change:!prior?'added':prior.hash!==e.hash?'changed':prior.path!==e.path?'moved':'unchanged'};});
 const missing=previous.filter(a=>!used.has(a.id));return{changes,missing,uncertain:changes.filter(c=>c.change==='added'&&missing.length),counts:{added:changes.filter(c=>c.change==='added').length,changed:changes.filter(c=>c.change==='changed').length,moved:changes.filter(c=>c.change==='moved').length,unchanged:changes.filter(c=>c.change==='unchanged').length,missing:missing.length}};
}
export function courseTree(articles){const root={id:'root',title:'课程',children:[]};for(const a of articles){const parts=a.path.split('/');let parent=root,path='';for(const name of parts.slice(0,-1)){path+=(path?'/':'')+name;let node=parent.children.find(n=>n.type==='module'&&n.path===path);if(!node){node={id:'m-'+stableHash(path),type:'module',path,title:name,children:[]};parent.children.push(node);}parent=node;}parent.children.push({id:a.id,type:'article',title:a.title,path:a.path,format:articleFormat(a),missing:!!a.missing});}const sort=n=>{n.children?.sort((a,b)=>naturalCompare(a.title,b.title));n.children?.forEach(sort);};sort(root);return root;}
export function flatten(node){return node.type==='article'?[node]:node.children.flatMap(flatten);}
export function moduleCount(tree){return(tree.type==='module'?1:0)+(tree.children||[]).reduce((s,n)=>s+moduleCount(n),0);}
export function completion(tree,states={}){const articles=flatten(tree);const done=articles.filter(a=>states[a.id]?.completed).length;return{done,total:articles.length,percent:articles.length?done/articles.length*100:0};}
export function ancestors(article){const parts=article.path.split('/').slice(0,-1);return parts.map((_,i)=>parts.slice(0,i+1).join('/'));}
export function articleAssets(manifest,article){return new Proxy({}, {get:(_,href)=>typeof href==='string'?manifest.resources?.[relativeTarget(article.path,href)]?.file:undefined});}
export function articleLinks(manifest,article){return new Proxy({}, {get:(_,href)=>manifest.articles.find(a=>a.path===relativeTarget(article.path,String(href)))?.id});}
export function newArticleState(){return{version:1,bookmarks:[],annotations:[],completed:false};}
// Exact, unique text anchors are safe to relocate. Ambiguous matches are kept for manual review.
export function findTextRange(doc,text){if(!text?.trim())return null;const walker=doc.createTreeWalker(doc.body,4),nodes=[];let n,all='';while(n=walker.nextNode()){nodes.push({node:n,start:all.length});all+=n.textContent;}const start=all.indexOf(text);if(start<0||all.indexOf(text,start+1)>=0)return null;const end=start+text.length,a=nodes.find(n=>n.start+n.node.length>start),b=nodes.find(n=>n.start+n.node.length>=end);if(!a||!b)return null;const range=doc.createRange();range.setStart(a.node,start-a.start);range.setEnd(b.node,end-b.start);return range;}
export async function persistCourse(library,scan,plan,old,id,progress=()=>{}){
 const resources={...(old?.resources||{})},articles=[],failures=[...(scan.failures||[])];
 let written=0;
 for(const r of scan.resources){
  if(resources[r.path]?.hash===r.hash)continue;
  resources[r.path]={hash:r.hash,file:await library.persistOwned(r.file,id,(resources[r.path]?'source/revisions/'+r.hash+'/':'source/course/')+r.path)};
  written++;
 }
 for(const [index,c] of plan.changes.entries()){
  const format=articleFormat(c),revisions=[...(c.prior?.revisions||[])];
  const show=(phase,done,total)=>progress(index+1,plan.changes.length,c.path,phase,done,total);
  show('正在处理');
  let file=c.prior?.hash===c.hash?c.prior.file:undefined;
  try{
   if(!file){
    const priorVersion=format==='PDF'&&revisions.find(r=>r.hash===c.hash);
    file=priorVersion?.file||(format==='PDF'
     ? await library.persistPDF(c.file,id,'source/course/'+c.id+'/'+c.hash+'/'+pdfAssetName(c.file.name),c.hash,show)
     : await library.persistOwned(c.file,id,(c.prior?'source/revisions/'+c.hash+'/':'source/course/')+c.path));
    if(!priorVersion)written++;
   }
  }catch(error){
   if(format!=='PDF')throw error;
   failures.push({path:c.path,error:error.message});
   if(c.prior)articles.push(c.prior);
   continue;
  }
  if(c.prior&&c.prior.hash!==c.hash&&!revisions.some(r=>r.hash===c.prior.hash))revisions.push({hash:c.prior.hash,file:c.prior.file,at:Date.now()});
  articles.push({id:c.id,path:c.path,title:c.title,format,hash:c.hash,file,revisions,missing:false,...(c.stamp?{stamp:c.stamp}:{})});
 }
 for(const a of plan.missing)articles.push({...a,format:articleFormat(a),missing:true});
 if(!articles.length)throw Error(failures.map(f=>f.path+'：'+f.error).join('\n'));
 articles.sort((a,b)=>naturalCompare(a.path,b.path));
 const fingerprint=failures.length?await folderFingerprint(articles.filter(a=>!a.missing),scan.resources):scan.fingerprint;
 const manifest={version:1,id,root:scan.root,revision:Date.now(),fingerprint,articles,resources};
 return{manifest,written,failures};
}
