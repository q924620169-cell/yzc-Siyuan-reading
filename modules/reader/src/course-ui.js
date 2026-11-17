import{el,button,field,modal,report}from'./dom.js';
import{toggleBranch}from'./tree-motion.js';
import{nodeID,safeAsset}from'./model.js';
import{scanFolder,planUpdate,persistCourse,courseTree,courseFormat,articleFormat,moduleCount,flatten,completion,ancestors,articleAssets,articleLinks,newArticleState,findTextRange}from'./course.js';
import{isPDF}from'./pdf.js';
import{popover}from'./controls.js';
import{importProgress,importResults}from'./pdf-ui.js';
export const courseMethods={
 pickCourse(book){const input=el('input');input.type='file';input.webkitdirectory=true;input.hidden=true;input.dataset.readerPicker='course';document.body.append(input);input.addEventListener('cancel',()=>input.remove(),{once:true});input.onchange=()=>this.importCourse([...input.files],book).catch(report).finally(()=>input.remove());input.click();},
 async courseManifest(book){const file=await this.library.original(book);const manifest=JSON.parse(await file.text());if(manifest.version!==1||!Array.isArray(manifest.articles))throw Error('课程索引版本不支持');return manifest;},
 async importCourse(files,book){
  const readable=files.filter(f=>f.webkitRelativePath&&/\.(md|pdf)$/i.test(f.name));
  if(!book&&readable.length===1&&isPDF(readable[0].name))return this.importFile(readable[0]);
  const busy=modal('识别课程文件夹',(body,footer)=>{
   const status=el('p','yr-scan-progress','正在读取目录…');
   status.setAttribute('role','status');
   body.append(status);
   footer.firstElementChild.disabled=true;
  });
  busy.dataset.busy='true';
  let scan,old;
  try{
   old=book?await this.courseManifest(book):undefined;
   scan=await scanFolder(files,(done,total)=>{busy.querySelector('.yr-scan-progress').textContent=`正在识别 ${done} / ${total} 个文件`;},old);
  }finally{busy.close();busy.remove();}
  const duplicate=!book&&this.library.books.some(b=>b.fingerprint===scan.fingerprint);
  const id=book?.id||nodeID(),choices={},initialPlan=planUpdate(scan,old);
  const tree=courseTree(scan.entries.map((entry,i)=>({...entry,id:String(i)})));
  return new Promise(resolve=>{
   const dialog=modal(book?'更新课程内容':'导入课程文件夹',(body,footer,close)=>{
    const type=el('select'),course=el('option','','系列课程');
    course.value='course';
    type.append(course);
    if(!book){
     const separate=el('option','','多本独立书籍');
     separate.value='books';
     type.append(separate);
     const label=el('label','yr-field','识别类型');
     label.append(type);
     body.append(label);
    }
    const title=field('课程名称',book?.title||scan.root),author=field('作者',book?.author||'');
    body.append(title.wrap,author.wrap);
    const lists=this.listChecks(body,book?.lists||[]);
    const pdfCount=scan.entries.filter(e=>e.format==='PDF').length;
    const formats=pdfCount?`${scan.entries.length-pdfCount} 篇 Markdown · ${pdfCount} 篇 PDF`:`${scan.entries.length} 篇 Markdown`;
    body.append(el('p','yr-muted',`${moduleCount(tree)} 个模块 · ${formats} · ${scan.resources.length} 个图片资源`));
    const preview=el('div','yr-course-preview');
    const render=(node,parent)=>{
     for(const n of node.children){
      if(n.type==='module'){
       const details=el('details');
       details.append(el('summary','',n.title));
       render(n,details);
       parent.append(details);
      }else parent.append(el('div','yr-preview-article',n.title+(n.format==='PDF'?' · PDF':'')));
     }
    };
    render(tree,preview);
    body.append(preview);
    if(scan.skipped.length)body.append(el('p','yr-muted',`跳过 ${scan.skipped.length} 个不支持的文件：${scan.skipped.slice(0,8).join('、')}${scan.skipped.length>8?'…':''}`));
    if(scan.failures.length){
     const failed=el('details');
     failed.append(el('summary','',`${scan.failures.length} 份 PDF 未通过检查`));
     for(const f of scan.failures)failed.append(el('p','yr-muted',f.path+'：'+f.error));
     body.append(failed);
    }
    if(book){
     const c=initialPlan.counts;
     body.append(el('p','yr-update-summary',`新增 ${c.added} · 内容变更 ${c.changed} · 改名或移动 ${c.moved} · 未变化 ${c.unchanged} · 源文件缺失 ${c.missing}`));
     if(initialPlan.changes.some(change=>change.format==='PDF'&&change.change==='changed')){
      body.append(el('p','yr-muted','已修改的 PDF 将另存为新版本。原生标注和位置保留在旧版，可从课程目录打开旧版。'));
     }
     if(c.missing){
      const details=el('details');
      details.append(el('summary','',`保留 ${c.missing} 篇源文件缺失的文章与全部阅读记录`));
      for(const a of initialPlan.missing)details.append(el('p','yr-muted',a.path));
      body.append(details);
     }
     for(const c of initialPlan.uncertain){
      const candidates=initialPlan.missing.filter(a=>articleFormat(a)===articleFormat(c));
      if(!candidates.length)continue;
      const label=el('label','yr-field',c.path),select=el('select');
      select.setAttribute('aria-label','匹配 '+c.path);
      select.append(new Option('作为新文章',''));
      for(const a of candidates)select.append(new Option(a.path,a.id));
      select.onchange=()=>{choices[c.path]=select.value;};
      label.append(select);
      body.append(label);
     }
    }
    const status=el('p','yr-muted');
    status.setAttribute('role','status');
    body.append(status);
    const save=button(book?'确认更新':'加入书库',async()=>{
     if(type.value==='books'){
      const selected=lists();
      close();
      await this.importFiles(readable,selected);
      return;
     }
     if(duplicate)throw Error('该课程已在书库中，请使用「更新课程内容」');
     dialog.dataset.busy='true';
     save.disabled=footer.firstElementChild.disabled=true;
     status.textContent='正在保存原件和课程索引…';
     const details={title:title.input.value.trim()||book?.title||scan.root,author:author.input.value.trim(),lists:lists()};
     try{
      const plan=planUpdate(scan,old,choices);
      const {manifest,written,failures}=await persistCourse(this.library,scan,plan,old,id,(index,total,path,phase,done,size)=>{
       status.textContent=`${index} / ${total} · ${path} · ${importProgress(phase,done,size)}`;
      });
      const file=await this.library.persist(new File([JSON.stringify(manifest)],'course.json'),id,'index-'+manifest.revision);
      const patch={...details,file,format:courseFormat(manifest.articles),fingerprint:manifest.fingerprint};
      if(book){
       const state=await this.library.state(id);
       state.course||={articles:{}};
       for(const change of plan.changes.filter(c=>c.change==='changed'&&articleFormat(c)==='MD')){
        const s=state.course.articles[change.id];
        if(!s)continue;
        s.history||=[];
        s.history.push({hash:change.prior.hash,at:Date.now(),location:s.location,bookmarks:structuredClone(s.bookmarks),annotations:structuredClone(s.annotations)});
        s.needsReanchor=true;
        s.previousHash=change.prior.hash;
       }
       await this.library.saveState(id,state);
       const progress=completion(courseTree(manifest.articles),state.course.articles).percent;
       await this.library.update(book,{...patch,progress,status:book.status==='已读完'&&progress<100?'正在阅读':book.status});
      }else{
       await this.library.saveState(id,{version:2,course:{articles:{}},bookmarks:[],annotations:[]});
       await this.library.add({...patch,id,kind:'系列课程',serial:'',status:'未开始',progress:0,lastRead:0});
      }
      this.lastCourseImport={...plan.counts,written,articles:manifest.articles.length};
      this.filter='all';
      dialog.dataset.busy='false';
      close();
      this.shelf();
      if(failures.length)importResults(plan.changes.length-failures.length+scan.failures.length,failures);
      else if(pdfCount)this.notify?.(`书房：${book?'已更新':'已导入'} ${plan.changes.length} 篇文章`);
     }catch(error){
      if(!book)await this.library.discardImport(id);
      throw error;
     }finally{
      dialog.dataset.busy='false';
      save.disabled=footer.firstElementChild.disabled=false;
     }
    });
    type.onchange=()=>{
     const independent=type.value==='books';
     title.wrap.hidden=author.wrap.hidden=independent;
     status.textContent=independent?`将逐本导入 ${readable.length} 份文件`:'';
    };
    footer.append(save);
   });
   dialog.addEventListener('close',()=>resolve(),{once:true});
  });
 },
 async prepareCourse(book,articleID){const manifest=await this.courseManifest(book),envelope=await this.library.state(book.id);envelope.version=2;envelope.course||={articles:{}};const tree=courseTree(manifest.articles),order=flatten(tree);const id=articleID||envelope.course.currentArticleId||order[0]?.id,article=manifest.articles.find(a=>a.id===id)||manifest.articles[0];if(!article)throw Error('课程内没有文章');const state=envelope.course.articles[article.id]||newArticleState();envelope.course.articles[article.id]=state;envelope.course.currentArticleId=article.id;envelope.course.currentModule=ancestors(article).at(-1)||'';state.lastRead=Date.now();if(this.expandedCourse!==book.id){this.expandedCourse=book.id;this.manualExpanded=new Set();this.manualCollapsed=new Set();}this.course={manifest,envelope,tree,order,article};return{state,file:articleFormat(article)==='PDF'?null:await this.library.original(article),assets:articleAssets(manifest,article),links:articleLinks(manifest,article)};},
 renderCourseNav(nav){const search=el('input','yr-course-search');search.type='search';search.placeholder='搜索模块或文章';search.setAttribute('aria-label','搜索课程目录');search.value=this.courseQuery||'';const treeHost=el('div','yr-course-tree');nav.append(search,treeHost);const render=()=>{treeHost.replaceChildren();const query=search.value.trim().toLowerCase(),activePaths=new Set(ancestors(this.course.article));const matches=n=>n.title.toLowerCase().includes(query)||(n.children||[]).some(matches);const walk=(node,parent,inherited=false)=>{for(const n of node.children||[]){if(query&&!inherited&&!matches(n))continue;if(n.type==='module'){const d=el('details','yr-course-module');d.dataset.path=n.path;d.open=!!query||this.manualExpanded.has(n.path)||activePaths.has(n.path)&&!this.manualCollapsed.has(n.path);const summary=el('summary');summary.append(el('span','',n.title));summary.classList.toggle('selected',activePaths.has(n.path));summary.setAttribute('aria-expanded',String(d.open));const children=el('div','yr-course-children');children.hidden=!d.open;summary.onclick=e=>{e.preventDefault();const opening=summary.getAttribute('aria-expanded')!=='true';toggleBranch(d,opening);if(opening){this.manualExpanded.add(n.path);this.manualCollapsed.delete(n.path);}else{this.manualExpanded.delete(n.path);this.manualCollapsed.add(n.path);}};d.append(summary,children);walk(n,children,inherited||!!query&&n.title.toLowerCase().includes(query));parent.append(d);}else{const state=this.course.envelope.course.articles[n.id],active=n.id===this.course.article.id,b=button(n.title,()=>this.switchArticle(n.id));b.classList.add('yr-course-article');b.classList.toggle('selected',active);b.dataset.article=n.id;b.oncontextmenu=e=>{e.preventDefault();this.courseArticleMenu(n.id,b);};if(active)b.setAttribute('aria-current','page');const status=el('span','yr-article-state');status.setAttribute('aria-label',state?.completed?'已读完':(state?.location||state?.lastRead)?'阅读中':'未阅读');status.innerHTML='<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="3.5" fill="none" stroke="currentColor" stroke-width="1"/>'+(state?.completed?'<path d="m3.7 6 1.6 1.6 3-3" fill="none" stroke="currentColor" stroke-width="1"/>':(state?.location||state?.lastRead)?'<path d="M6 2.5a3.5 3.5 0 0 1 0 7Z" fill="currentColor"/>':'')+'</svg>';b.prepend(status);if(n.missing){b.title+=' · 源文件缺失，保留副本';b.append(el('small','yr-muted',' · 源文件缺失'));}parent.append(b);}}};walk(this.course.tree,treeHost);};search.oninput=()=>{this.courseQuery=search.value;render();};render();requestAnimationFrame(()=>treeHost.querySelector('[aria-current]')?.scrollIntoView({block:'nearest'}));},
 async switchArticle(id){
  const book=this.current,article=this.course?.manifest.articles.find(a=>a.id===id);
  if(!book||!article)return;
  for(const path of ancestors(article))this.manualCollapsed.delete(path);
  await this.read(book,id);
 },
 courseArticleMenu(id,anchor){
  const course=this.course,book=this.current,article=course?.manifest.articles.find(a=>a.id===id);
  if(!article||!book)return;
  this.popover?.close();
  this.popover=popover(anchor,(panel,close)=>{
   const complete=course.envelope.course.articles[id]?.completed;
   panel.append(button(complete?'撤销已读':'标记已读',async()=>{
    close();
    if(this.course!==course)return;
    await this.toggleArticleComplete(id);
   }));
   const previous=articleFormat(article)==='PDF'&&article.revisions?.filter(r=>r.file!==article.file).at(-1);
   if(previous)panel.append(button('查看旧版 PDF',()=>{close();return this.read(book,id,previous.file);}));
  },{label:'课程文章操作'});
 },
 async toggleArticleComplete(id){
  const course=this.course,states=course.envelope.course.articles;
  const state=states[id]??=newArticleState();
  state.completed=!state.completed;
  this.lastMetadata=0;
  await this.flush();
  if(this.course===course)this.renderSidebar();
 },
 courseFooter(doc){if(!this.course)return;const end=doc.createElement('nav');end.className='reader-course-end';end.setAttribute('aria-label','文章导航');end.style.cssText='display:flex;flex-wrap:wrap;gap:1.5em;justify-content:space-between;margin:4em 0 2em;font-size:.86em';const {order,article}=this.course,i=order.findIndex(a=>a.id===article.id);const add=(label,fn)=>{const b=doc.createElement('button');b.textContent=label;b.style.cssText='font:inherit;color:inherit;background:transparent;border:0;cursor:pointer;padding:.4em';b.onclick=()=>Promise.resolve(fn()).catch(report);end.append(b);};if(i>0)add('← 上一篇',()=>this.switchArticle(order[i-1].id));add(this.state.completed?'撤销已读':'标记已读',async()=>{await this.toggleArticleComplete(article.id);end.remove();this.courseFooter(doc);});if(i+1<order.length)add('下一篇 →',()=>this.switchArticle(order[i+1].id));doc.body.append(end);},
 async reanchorCourse(){if(!this.course)return;if(!this.state.needsReanchor){this.showAnchorNotice();return;}const{doc,index}=this.view.renderer.getContents()[0];const unresolved=[];const migrate=item=>{const text=item.anchorText||item.text,range=findTextRange(doc,text);if(!range){item.unresolved=true;unresolved.push(item);return;}item.previousCFI=item.cfi;item.cfi=this.view.getCFI(index,range);delete item.unresolved;};for(const item of[...this.state.bookmarks,...this.state.annotations])migrate(item);const old=this.state.location;if(old){const range=findTextRange(doc,old.text);if(range){this.state.location={...old,cfi:this.view.getCFI(index,range)};await this.view.goTo(this.state.location.cfi);}else{this.state.unresolvedLocation={...old};unresolved.push(old);}}
 this.state.needsReanchor=false;this.state.revision=this.course.article.hash;this.state.unresolvedCount=unresolved.length;await this.flush();this.showAnchorNotice();},
 showAnchorNotice(){if(this.state.unresolvedCount){const notice=el('div','yr-anchor-notice',`${this.state.unresolvedCount} 条位置记录需核对；原记录和旧版正文已保留。`);notice.append(button('查看旧版正文',async()=>{const rev=this.course.article.revisions?.at(-1);if(rev&&safeAsset(rev.file)){const file=await this.library.original(rev);const content=await file.text();modal('更新前的原文',(body)=>{const pre=el('pre','',content);pre.style.whiteSpace='pre-wrap';body.append(pre);});}}));this.root.insertBefore(notice,this.view);}},
 notes(){if(!this.course)return(this.state?.[this.navMode==='书签'?'bookmarks':'annotations']||[]).map(item=>({item,state:this.state}));const key=this.navMode==='书签'?'bookmarks':'annotations';return this.course.manifest.articles.flatMap(a=>(this.course.envelope.course.articles[a.id]?.[key]||[]).map(item=>({item,state:this.course.envelope.course.articles[a.id],article:a})));},
 async goNote(entry){if(entry.article&&entry.article.id!==this.course?.article.id){await this.switchArticle(entry.article.id);entry.item=[...this.state.bookmarks,...this.state.annotations].find(i=>i.id===entry.item.id)||entry.item;}if(entry.item.unresolved)throw Error('原文已变化，这条位置暂无法准确匹配。摘录原文仍保留，请核对旧版正文。');await this.view?.goTo(entry.item.cfi);}
};
