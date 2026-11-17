import{api,putFile,getJSON}from'./storage.js';
import{safeAsset}from'./model.js';
import{isPDF,verifyPDF}from'./pdf.js';
const stateRoot='/data/storage/petal/yzc-Siyuan-reading/reader',assetRoot='assets/yzc-reader/books/';
export const isOwnedPDFAsset=path=>typeof path==='string'&&path.startsWith(assetRoot)&&isPDF(path);
export function bookPaths(id){if(!/^\d{14}-[a-z0-9]{7}$/.test(id))throw Error('无效藏书 ID');return{assets:assetRoot+id+'/',state:stateRoot+'/books/'+id};}
// Preserve hierarchy and original index paths; escape characters rejected by the host file API.
export const diskPart=part=>part.replace(/[_~%\[\]<>:"|?*()!`&{}=#$;\x00-\x1f]/g,c=>'_'+c.charCodeAt(0).toString(16));
function ownedAsset(id,relative){
 const {assets}=bookPaths(id);
 if(!relative||relative.split('/').some(s=>!s||s==='..'||s==='.')||relative.includes('\\'))throw Error('不安全的藏书路径');
 return assets+relative.split('/').map(part=>encodeURIComponent(diskPart(part)).replaceAll("'",'%27')).join('/');
}
const hash=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),x=>x.toString(16).padStart(2,'0')).join('');
const readOwnedAsset=path=>fetch('/api/file/getFile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:'/data/'+decodeURIComponent(path)})});
export const writeJSON=(path,value)=>putFile(path,new Blob([JSON.stringify(value)],{type:'application/json'}));
async function exists(path){const r=await fetch('/api/file/getFile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path})});if(r.status===404)return false;if(!r.ok)throw Error('无法核对文件');const type=r.headers.get('content-type')||'';if(type.includes('json')){const data=await r.clone().json().catch(()=>null);if(data?.code===404)return false;}return true;}
async function erase(path){try{await api('/api/file/removeFile',{path});}catch(e){if(!/不存在|not exist|no such/i.test(e.message))throw e;}}
export const ownedMethods={
 async persistOwned(file,id,relative){const path=ownedAsset(id,relative);const prior=await readOwnedAsset(path);if(prior.ok&&await hash(await prior.blob())===await hash(file))return path;try{await putFile('/data/'+decodeURIComponent(path),file);}catch(e){throw Error('保存副本 '+relative+'：'+e.message);}const response=await readOwnedAsset(path);if(!response.ok||await hash(await response.blob())!==await hash(file))throw Error('副本校验失败，未加入书库');return path;},
 async persistPDF(file,id,relative,fingerprint,progress=()=>{}){
  const path=ownedAsset(id,relative),disk='/data/'+decodeURIComponent(path);
  try{
   progress('正在复制');
   await putFile(disk,file);
   const response=await fetch('/'+path,{cache:'no-store'});
   await verifyPDF(response,file.size,fingerprint,(done,total)=>progress('正在校验副本',done,total));
   return path;
  }catch(error){
   try{await erase(disk);}catch(cleanup){throw Error(error.message+'；清理不完整副本失败：'+cleanup.message);}
   throw error;
  }
 },
 async discardImport(id){if(this.config.avID)await this.refresh();if(this.books.some(b=>b.id===id))return;const p=bookPaths(id);await erase('/data/'+p.assets.slice(0,-1));await erase(p.state);},
 async ensureOwned(book){const p=bookPaths(book.id);if(this.deleted?.has(book.id))throw Error('书籍正在删除');if(book.file.startsWith(p.assets)){const meta=await getJSON(p.state+'/metadata.json',null);if(meta?.pending)return this.ensureOwned({...book,...meta.pending});if(!meta)await writeJSON(p.state+'/metadata.json',{version:1,bookId:book.id,kind:book.kind,created:Date.now()});return;}
  const mapping=new Map(),legacy=[];const copy=async(path,target)=>{if(!safeAsset(path))throw Error('旧藏书存在外部或无效引用，请重新选择来源文件后迁移');if(path.startsWith(p.assets))return path;if(mapping.has(path))return mapping.get(path);const r=await fetch('/'+path);if(!r.ok)throw Error('迁移来源缺失：'+path);const file=await r.blob(),next=await this.persistOwned(file,book.id,target||'source/legacy/'+mapping.size+'-'+path.split('/').pop());mapping.set(path,next);legacy.push(path);return next;};
  const rewrite=async value=>{if(typeof value==='string'&&safeAsset(value))return copy(value);if(Array.isArray(value))return Promise.all(value.map(rewrite));if(value&&typeof value==='object'){const out={};for(const[k,v]of Object.entries(value))out[k]=await rewrite(v);return out;}return value;};
  const oldState=await this.state(book.id),state=await rewrite(oldState);let file;
  if(book.kind==='系列课程'){const response=await fetch('/'+book.file);if(!response.ok)throw Error('课程索引缺失');const manifest=await response.json();for(const article of manifest.articles){article.file=await copy(article.file,'source/course/'+article.path);article.revisions=await rewrite(article.revisions||[]);}for(const[path,res]of Object.entries(manifest.resources||{}))res.file=await copy(res.file,'source/course/'+path);legacy.push(book.file);file=await this.persistOwned(new Blob([JSON.stringify(manifest)]),book.id,'source/index.json');}
  else file=await copy(book.file,'source/original.'+book.format.toLowerCase());
  const cover=book.cover?await copy(book.cover,'cover/'+book.cover.split('/').pop()):'';await this.saveState(book.id,state);await writeJSON(p.state+'/metadata.json',{version:1,bookId:book.id,legacy,pending:{file:book.file,cover:book.cover,kind:book.kind}});await this.update(book,{file,cover});await writeJSON(p.state+'/metadata.json',{version:1,bookId:book.id,legacy});await erase(stateRoot+'/books/'+book.id+'.json');
 },
 async migrateAll(){if(this.migrating)return this.migrating;this.migrating=(async()=>{await this.resumeDeletions();for(const book of [...this.books])await this.ensureOwned(book);await this.cleanLegacy();})();try{await this.migrating;}finally{this.migrating=undefined;}},
 async cleanLegacy(){const referenced=new Set(),collect=v=>{if(typeof v==='string'&&safeAsset(v))referenced.add(v);else if(v&&typeof v==='object')Object.values(v).forEach(collect);};for(const book of this.books){collect(book);collect(await this.state(book.id));if(book.kind==='系列课程'){const r=await fetch('/'+book.file);if(!r.ok)throw Error('无法检查课程引用');collect(await r.json());}}for(const book of this.books){const p=bookPaths(book.id),meta=await getJSON(p.state+'/metadata.json',{});for(const path of meta.legacy||[])if(path.startsWith('assets/yzc-reader/')&&!path.startsWith(assetRoot)&&!referenced.has(path))await erase('/data/'+decodeURIComponent(path));if(meta.legacy?.length){meta.legacy=meta.legacy.filter(path=>referenced.has(path));await writeJSON(p.state+'/metadata.json',meta);}}},
 async resumeDeletions(){let ops=[];try{ops=await api('/api/file/readDir',{path:stateRoot+'/operations'});}catch(e){if(!/不存在|not exist|no such/i.test(e.message))throw e;}for(const op of ops||[])if(op.name?.endsWith('.delete.json')){const job=await getJSON(stateRoot+'/operations/'+op.name,null);if(job)await this.finishDelete(job.id);}},
 async remove(book){await this.ensureOwned(book);this.deleted??=new Set();this.deleted.add(book.id);this.wereadClient?.stop(book.id);await this.queue;await writeJSON(stateRoot+'/operations/'+book.id+'.delete.json',{version:1,id:book.id,title:book.title,at:Date.now()});await this.finishDelete(book.id);},
 async finishDelete(id){const p=bookPaths(id);this.deleted??=new Set();this.deleted.add(id);if(this.books.some(b=>b.id===id))await api('/api/av/removeAttributeViewBlocks',{avID:this.config.avID,srcIDs:[id]});this.books=this.books.filter(b=>b.id!==id);await erase('/data/'+p.assets.slice(0,-1));await erase(p.state);await erase(stateRoot+'/books/'+id+'.json');if(this.config.lastSession?.bookID===id){delete this.config.lastSession;await this.saveConfig();}await erase(stateRoot+'/operations/'+id+'.delete.json');},
};
