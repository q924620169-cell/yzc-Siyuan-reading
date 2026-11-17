import{el,button,field,modal}from'./dom.js';

/** Serialize Foliate iterators so a closed or replaced search cannot draw later. */
export class ReadingSearch{
 constructor(ui){this.ui=ui;this.version=0;}
 clear(){
  ++this.version;this.hasHighlights=false;
  this.view?.clearSearch();
 }
 close(){const dialog=this.dialog;this.clear();dialog?.close();dialog?.remove();}
 open(){
  if(this.dialog?.open){this.dialog.querySelector('input').focus();return;}
  const view=this.view=this.ui.view;if(!view)return;
  let keep=false,finished=false;
  const dialog=modal('搜索当前书籍',(body,footer,close)=>{
   const query=field('搜索内容'),results=el('div','yr-search-results'),status=el('p','yr-search-status');
   status.setAttribute('role','status');results.setAttribute('aria-label','搜索结果');
   query.input.type='search';body.append(query.wrap,status,results);
   const run=()=>{
    this.clear();const version=this.version,value=query.input.value.trim();finished=false;
    results.replaceChildren();status.textContent=value?'正在搜索…':'';
    const valid=()=>version===this.version&&dialog.open&&this.ui.view===view;
    this.job=(this.job||Promise.resolve()).catch(()=>{}).then(async()=>{
     if(!valid()||!value)return;
     view.clearSearch();let count=0;
     try{
      for await(const group of view.search({query:value})){
       if(!valid())break;
       for(const item of group.subitems||[]){
        const row=button('跳转到搜索结果',async()=>{
         keep=finished;close();await view.goTo(item.cfi);view.focus();
        });
        row.replaceChildren();row.classList.add('yr-search-result');
        const label=[...new Set([this.ui.course?.article.title,group.label].filter(Boolean))].join(' · ');
        if(label)row.append(el('small','yr-search-chapter',label));
        const excerpt=el('span','yr-search-excerpt');
        if(typeof item.excerpt==='string')excerpt.textContent=item.excerpt;
        else excerpt.append(document.createTextNode(item.excerpt?.pre||''),el('mark','',item.excerpt?.match||value),document.createTextNode(item.excerpt?.post||''));
        row.append(excerpt);row.setAttribute('aria-label','跳转到 '+label+' '+excerpt.textContent);results.append(row);this.hasHighlights=true;
        if(++count>=100)break;
       }
       if(count>=100)break;
      }
      if(valid()){finished=true;status.textContent=count?`找到 ${count>=100?'至少 ':''}${count} 条结果`:'未找到匹配文字。';}
     }catch(error){if(valid())status.textContent='搜索失败，'+error.message;}
     finally{if(!valid())view.clearSearch();}
    });
   };
   footer.append(button('搜索',run));
   query.input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();run();}};
  });
  dialog.classList.add('yr-search-dialog');this.dialog=dialog;
  dialog.addEventListener('keydown',event=>{
   if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();this.close();}
  },{capture:true});
  dialog.addEventListener('close',()=>{
   if(this.dialog!==dialog)return;
   if(!keep)this.clear();
   this.dialog=undefined;
  },{once:true});
  dialog.querySelector('input').focus();
 }
}
