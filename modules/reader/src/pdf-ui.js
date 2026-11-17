import {el,button,field,modal} from './dom.js';
import {nodeID,safeAsset} from './model.js';
import {bookPaths} from './owned-storage.js';
import {inspectPDF,isPDF,pdfAssetName,pdfFingerprint} from './pdf.js';

export function importProgress(phase,done,total){
 return total?phase+' '+Math.round(done/total*100)+'%':phase;
}

export function importResults(succeeded,failures){
 modal('导入结果',(body,footer,close)=>{
  body.append(el('p','yr-muted',`成功 ${succeeded} 项 · 失败 ${failures.length} 项`));
  if(failures.length){
   const list=el('ul','yr-import-failures');
   for(const f of failures)list.append(el('li','',f.path+'：'+f.error));
   body.append(list);
  }
  footer.replaceChildren(button('完成',close));
 });
}

export const pdfMethods={
 async importPDFs(files,initialLists=[]){
  const single=files.length===1;
  const metadata=single?await inspectPDF(files[0]):null;
  return new Promise(resolve=>{
   const dialog=modal(single?'导入书籍':'批量导入 PDF',(body,footer,close)=>{
    body.append(el('p','yr-muted',single?'普通书籍 · PDF':`普通书籍 · ${files.length} 份 PDF`));
    const title=single?field('书名',metadata.title):null,author=single?field('作者',metadata.author):null;
    if(single)body.append(title.wrap,author.wrap);
    else body.append(el('p','yr-muted',files.slice(0,6).map(f=>f.name).join('、')+(files.length>6?'…':'')));
    const lists=this.listChecks(body,initialLists),status=el('p','yr-muted');
    status.setAttribute('role','status');
    body.append(status);
    const save=button('加入书库',async()=>{
     dialog.dataset.busy='true';
     save.disabled=footer.firstElementChild.disabled=true;
     const selected=lists(),failures=[];
     const edited=single?{title:title.input.value.trim()||metadata.title,author:author.input.value.trim()}:null;
     let succeeded=0;
     try{
      for(const [index,file] of files.entries()){
       const show=(phase,done,total)=>{status.textContent=`${index+1} / ${files.length} · 成功 ${succeeded} · 失败 ${failures.length} · ${file.name} · ${importProgress(phase,done,total)}`;};
       const id=nodeID();
       let writing=false;
       try{
        show('正在检查');
        const info=edited||await inspectPDF(file);
        const hash=await pdfFingerprint(file,(done,total)=>show('正在计算指纹',done,total));
        if(this.library.books.some(b=>b.fingerprint===hash))throw Error('相同文件已在书库中');
        writing=true;
        const asset=await this.library.persistPDF(file,id,'source/'+pdfAssetName(file.name),hash,show);
        await this.library.add({...info,id,file:asset,fingerprint:hash,format:'PDF',kind:'普通书籍',lists:selected,status:'未开始',progress:0,lastRead:0});
        succeeded++;
       }catch(error){
        let message=error.message;
        if(writing){
         try{await this.library.discardImport(id);}catch(cleanup){message+='；无法清理：'+cleanup.message;}
        }
        if(this.library.books.some(b=>b.id===id))succeeded++;
        else failures.push({path:file.name,error:message});
       }
      }
     }finally{
      dialog.dataset.busy='false';
      close();
      this.filter='all';
      this.query='';
      this.shelf();
      importResults(succeeded,failures);
     }
    });
    footer.append(save);
   });
   dialog.addEventListener('close',()=>resolve(),{once:true});
  });
 },
 async openOwnedPDF(book,path){
  const generation=this.generation;
  if(!safeAsset(path)||!isPDF(path)||!path.startsWith(bookPaths(book.id).assets))throw Error('无效的书房 PDF 资源路径');
  const response=await fetch('/'+path,{headers:{Range:'bytes=0-0'},cache:'no-store'});
  await response.body?.cancel();
  if(this.generation!==generation)return;
  if(!response.ok)throw Error('PDF 副本不存在或无法访问');
  // Without an explicit destination, SiYuan can apply its own PDF view history.
  return this.openPDF(decodeURIComponent(path));
 },
 async readPDF(book,state,article,path){
  const course=this.course,generation=this.generation;
  this.current=book;
  this.state=state;
  this.pdfReading=true;
  this.navMode='目录';
  this.renderSidebar();
  await this.openOwnedPDF(book,path||article?.file||book.file);
  if(this.generation!==generation)return;
  const now=Date.now();
  state.lastRead=now;
  if(article){
   state.revision=article.hash;
   await this.library.saveState(book.id,course.envelope);
  }else await this.library.saveState(book.id,state);
  if(this.generation===generation){this.renderSidebar();this.rememberSession();}
  await this.library.update(book,{lastRead:now,status:book.status==='已读完'?'已读完':'正在阅读'});
 },
};
