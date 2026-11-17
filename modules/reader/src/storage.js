import{ownedMethods,bookPaths}from'./owned-storage.js';
import {nodeID,schema,cellValue,readValue,safeAsset,stableHash} from './model.js';
import {textCover,ensureTextCovers,isTextCover,coverVersion} from './covers.js';
export async function api(route,body={}){const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(response.ok===false)throw Error(`${route}: 思源接口不可用 (${response.status})`);const r=await response.json();if(r.code!==0){const error=Error(`${route}: ${r.msg||'接口不可用'}`);error.reason=r.data?.reason;throw error;}return r.data;}
async function createLibraryDocument(body){for(let attempt=0;;attempt++){try{return await api('/api/filetree/createDocWithMd',body);}catch(error){if(error.reason!=='indexUnavailable'||attempt>=19)throw error;await new Promise(resolve=>setTimeout(resolve,250));}}}
export async function putFile(path,file){const data=new FormData();data.append('path',path);data.append('isDir','false');data.append('file',file);const response=await fetch('/api/file/putFile',{method:'POST',body:data});if(response.ok===false)throw Error('思源文件写入失败（HTTP '+response.status+'）');const r=await response.json();if(r.code!==0)throw Error(r.msg||'思源文件写入失败');}
export async function getJSON(path,fallback){const r=await fetch('/api/file/getFile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path})});if(r.status===404)return fallback;if(!r.ok)throw Error('读取阅读数据失败');const data=await r.json();if(data.code===404)return fallback;if(data.code!==undefined)throw Error(data.msg||'阅读数据读取失败');return data;}
const root='/data/storage/petal/yzc-INL/reader';
export class Library{
  books=[];config={version:1,lists:[],weread:false};queue=Promise.resolve();
  async load(){await this.initializing;this.config=await getJSON(root+'/config.json',this.config);if(this.config.avID){if(!this.config.keys?.kind||!this.config.keys?.serial||!this.config.keys?.published)await this.completeSchema();else if(this.config.schemaReady)await this.refresh();await this.migrateAll();await ensureTextCovers(this);}}
  saveConfig(){return this.enqueue(()=>putFile(root+'/config.json',new Blob([JSON.stringify(this.config)],{type:'application/json'})));}
  enqueue(task){const result=this.queue.then(task);this.queue=result.catch(()=>{});return result;}
  async initialize(){
    if(this.initializing)return this.initializing;
    this.initializing=this.initializeOnce().finally(()=>this.initializing=undefined);return this.initializing;
  }
  async initializeOnce(){
    if(this.config.avID){if(!this.config.schemaReady)await this.completeSchema();return;}
    const {notebooks}=await api('/api/notebook/lsNotebooks');let notebook=notebooks.find(n=>['书房','阅读'].includes(n.name)&&!n.closed);
    if(!notebook)notebook=(await api('/api/notebook/createNotebook',{name:'书房'})).notebook;
    const avID=nodeID();const docID=await createLibraryDocument({notebook:notebook.id,path:'/藏书',markdown:`<div data-type="NodeAttributeView" data-av-id="${avID}" data-av-type="table"></div>`});
    this.config={...this.config,avID,docID,keys:{}};await this.completeSchema();
  }
  async completeSchema(){
    const rendered=await api('/api/av/renderAttributeView',{id:this.config.avID,page:1,pageSize:1});const cols=rendered.view.columns;
    this.config.keys.title=cols.find(c=>c.type==='block').id;
    for(const [name,[label,type]]of Object.entries(schema)){if(name==='title')continue;const found=cols.find(c=>c.name===label&&c.type===type);const key=found?.id||this.config.keys[name]||this.config.avID.slice(0,15)+stableHash(this.config.avID+name).padStart(7,'0').slice(0,7);if(!found)await api('/api/av/addAttributeViewKey',{avID:this.config.avID,keyID:key,keyName:label,keyType:type,keyIcon:"",previousKeyID:this.config.keys[Object.keys(schema)[Object.keys(schema).indexOf(name)-1]]||'',blockID:""});this.config.keys[name]=key;}
    await api('/api/transactions',{reqId:Date.now(),app:'yzc-reader',session:'yzc-reader',transactions:[{doOperations:[{action:'setAttrViewName',id:this.config.avID,data:'藏书'},{action:'updateAttrViewCol',avID:this.config.avID,id:this.config.keys.title,name:'书名',type:'block'}],undoOperations:[]}]});
    this.config.schemaReady=true;await this.saveConfig();await this.refresh();
  }
  async refresh(){
    const {av}=await api('/api/av/getAttributeView',{id:this.config.avID});if(!av?.keyValues)throw Error('当前思源不支持所需数据库接口，请升级后重试。');
    const primary=av.keyValues.find(k=>k.key.type==='block');const rows=new Map((primary?.values||[]).map(v=>[v.blockID,{id:v.blockID}]));
    for(const[name,[label,type]]of Object.entries(schema)){const column=av.keyValues.find(k=>k.key.id===this.config.keys?.[name])||av.keyValues.find(k=>k.key.name===label&&k.key.type===type);if(!column)throw Error(`藏书数据库缺少「${label}」字段，请恢复字段后重试。`);for(const value of column.values||[]){const b=rows.get(value.blockID);if(b)b[name]=readValue({...value,type});}}
    this.books=[...rows.values()].filter(b=>b.file).map(b=>({...b,lists:Array.isArray(b.lists)?b.lists:[]}));return this.books;
  }
  async add(book){await this.ensureOwned(book);await this.initialize();await this.refresh();if(this.books.some(b=>b.fingerprint===book.fingerprint))throw Error('相同文件已在书库中');const values=Object.entries(schema).map(([name,[,type]])=>({keyID:this.config.keys[name],blockID:book.id,type,...cellValue(type,book[name])}));await api('/api/av/appendAttributeViewDetachedBlocksWithValues',{avID:this.config.avID,blocksValues:[values]});await this.refresh();}
  async update(book,patch){if(this.deleted?.has(book.id))return;if(!patch.cover&&isTextCover(book.cover)&&('title'in patch||'author'in patch))patch={...patch,cover:await this.persist(textCover({...book,...patch}),book.id,coverVersion+'-'+Date.now())};if('progress'in patch)patch={...patch,progress:Math.round(patch.progress*100)/100};for(const[name,value]of Object.entries(patch)){if(this.deleted?.has(book.id))return;if(!schema[name])continue;await api('/api/av/setAttributeViewBlockAttr',{avID:this.config.avID,keyID:this.config.keys[name],itemID:book.id,value:{type:schema[name][1],...cellValue(schema[name][1],value)}});}Object.assign(book,patch);const cached=this.books.find(b=>b.id===book.id);if(cached&&cached!==book)Object.assign(cached,patch);}
  async remove(book){await api('/api/av/removeAttributeViewBlocks',{avID:this.config.avID,srcIDs:[book.id]});this.books=this.books.filter(b=>b.id!==book.id);}
  async state(id){return getJSON(bookPaths(id).state+'/reading.json',await getJSON(`${root}/books/${id}.json`,{version:1,bookmarks:[],annotations:[]}));}
  saveState(id,state){if(this.deleted?.has(id))return Promise.resolve();const content=JSON.stringify(state);return this.enqueue(()=>this.deleted?.has(id)?Promise.resolve():putFile(bookPaths(id).state+'/reading.json',new Blob([content],{type:'application/json'})));}
  async original(book){if(!safeAsset(book.file))throw Error('书籍文件必须引用思源 assets 中的安全资源路径');const r=await fetch('/'+book.file);if(!r.ok)throw Error('书籍原件不存在，请检查数据库的文件字段');return new File([await r.blob()],book.file.split('/').pop());}
  async persist(file,hash,name='original'){const ext=file.name?.split('.').pop()?.toLowerCase()||'bin';return this.persistOwned(file,hash,(name.startsWith('cover')||name.startsWith('generated-cover')?'cover/':'source/')+name+'.'+ext);}
}
Object.assign(Library.prototype,ownedMethods);
