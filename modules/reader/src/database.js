import{api}from'./storage.js';import{nodeID}from'./model.js';import{el,button}from'./dom.js';
import{ensureTextCovers}from'./covers.js';
const tx=operations=>api('/api/transactions',{reqId:Date.now(),app:'yzc-reader',session:'reader-database',transactions:[{doOperations:operations,undoOperations:[]}]});
export async function prepareDatabase(library){
 await library.initialize();const c=library.config;
 await ensureTextCovers(library);if(c.coverPresentation!==3){c.coverPresentation=3;await library.saveConfig();}if(c.databasePresentation===4)return;
 const rows=await api('/api/query/sql',{stmt:`SELECT id FROM blocks WHERE root_id='${c.docID}' AND type='av' LIMIT 1`});
 const blockID=rows[0]?.id;if(!blockID)throw Error('藏书数据库块不存在，请检查藏书文档');
 let{av}=await api('/api/av/getAttributeView',{id:c.avID});const table=av.views.find(v=>v.type==='table');if(!table)throw Error('藏书数据库缺少原生表格视图');
 const gallery=av.views.find(v=>v.type==='gallery'),galleryID=gallery?.id||nodeID();
 if(!gallery)await tx([{action:'addAttrViewView',avID:c.avID,id:galleryID,blockID,layout:'gallery',name:'封面画廊'}]);
 await tx([{action:'setAttrViewBlockView',avID:c.avID,id:galleryID,blockID},{action:'setAttrViewCardAspectRatio',avID:c.avID,blockID,data:5},{action:'setAttrViewCardSize',avID:c.avID,blockID,data:0},{action:'setAttrViewCoverFrom',avID:c.avID,blockID,data:2},{action:'setAttrViewCoverFromAssetKeyID',avID:c.avID,blockID,keyID:c.keys.cover},{action:'setAttrViewFitImage',avID:c.avID,blockID,data:true},{action:'setAttrViewShowIcon',avID:c.avID,blockID,data:false}]);
 ({av}=await api('/api/av/getAttributeView',{id:c.avID}));
 for(const book of library.books)if(book.cover)await library.update(book,{cover:book.cover});
 const visible=['title','author','format','kind','status','progress','lists','cover','lastRead'];
 const ops=[];
 for(const view of av.views.filter(v=>[table.id,galleryID].includes(v.id))){const shown=new Set((view.id===table.id?visible:['title','author','status']).map(k=>c.keys[k]));for(const kv of av.keyValues)ops.push({action:'setAttrViewColHidden',avID:c.avID,blockID,viewID:view.id,id:kv.key.id,data:!shown.has(kv.key.id)});}
 ops.push({action:'setAttrViewBlockView',avID:c.avID,blockID,id:galleryID});let galleryPrevious='';for(const key of ['title','author','status']){ops.push({action:'sortAttrViewCol',avID:c.avID,blockID,id:c.keys[key],previousID:galleryPrevious});galleryPrevious=c.keys[key];}ops.push({action:'setAttrViewColWrap',avID:c.avID,blockID,id:c.keys.title,data:true});
 ops.push({action:'setAttrViewBlockView',avID:c.avID,blockID,id:table.id},{action:'setAttrViewViewName',avID:c.avID,blockID,id:table.id,data:'藏书表格'});
 let previous='';for(const k of visible){ops.push({action:'sortAttrViewCol',avID:c.avID,blockID,id:c.keys[k],previousID:previous});previous=c.keys[k];}
 ops.push({action:'setAttrViewColWidth',avID:c.avID,blockID,id:c.keys.title,data:'240px'},{action:'setAttrViewColWidth',avID:c.avID,blockID,id:c.keys.author,data:'150px'});
 await tx(ops);
 for(const book of library.books)if(!book.kind)await library.update(book,{kind:'普通书籍'});
 const check=(await api('/api/av/getAttributeView',{id:c.avID})).av;
 const tableColumns=check.views.find(v=>v.id===table.id).table.columns;
 if(!tableColumns.find(col=>col.id===c.keys.fingerprint)?.hidden)throw Error('思源没有应用数据库字段配置，请检查当前版本兼容性');
 c.databasePresentation=4;c.databaseBlockID=blockID;c.tableViewID=table.id;c.galleryViewID=galleryID;await library.saveConfig();
}
export const databaseMethods={
 async openDatabase(){
  if(this.database)return;await this.flush();await this.closeBook();await prepareDatabase(this.library);this.renderSidebar();
  this.root.replaceChildren();const header=el('header','yr-database-header');header.append(button('← 返回书架',()=>this.leaveDatabase()),el('h1','','藏书数据库'));
  const host=el('div','yr-database-host');this.root.append(header,host);
  this.database=this.createDatabase(host,{blockId:this.library.config.docID,mode:'wysiwyg',render:{background:false,title:false,gutter:false,breadcrumb:false,scroll:false}});
 },
 async leaveDatabase(){this.database?.destroy();this.database=undefined;await this.library.refresh();this.shelf();},
};
