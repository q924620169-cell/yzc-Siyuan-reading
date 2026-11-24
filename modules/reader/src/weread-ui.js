import{el,button,modal,report}from'./dom.js';
export const wereadMethods={
 wereadSettings(){
  const row=el('div','yr-setting-row yr-key-row'),label=el('label','yr-setting-title','Agent API Key'),controls=el('div','yr-key-controls'),entry=el('div','yr-key-entry'),input=el('input','yr-key-input'),status=el('small','yr-muted');
  input.id='yr-weread-key';label.htmlFor=input.id;input.type='password';input.placeholder='输入 Agent API Key';input.autocomplete='off';input.spellcheck=false;input.disabled=true;status.setAttribute('role','status');
  const reveal=button('显示密钥',()=>{const visible=input.type==='password';input.type=visible?'text':'password';reveal.textContent=visible?'隐藏':'显示';reveal.setAttribute('aria-label',visible?'隐藏密钥':'显示密钥');reveal.setAttribute('aria-pressed',String(visible));});reveal.textContent='显示';reveal.setAttribute('aria-pressed','false');
  let disposed=false;
  const paint=(value,text)=>{if(!disposed&&input.value.trim()===value)status.textContent=text;};
  const validate=async value=>{if(!value||!this.library.config.weread)return;paint(value,'正在验证…');try{const ok=await this.weread.verifyKey(value);paint(value,ok?'接口已验证':'接口验证未通过');}catch{paint(value,'验证暂不可用，密钥已保存');}};
  const save=button('保存',async()=>{
   const value=input.value.trim();save.disabled=true;paint(value,'正在保存…');
   try{await this.weread.saveKey(value);paint(value,value?'已保存，尚未验证':'已清除');void validate(value);}
   catch{paint(value,'密钥保存失败，请重试');if(disposed)report(Error('书房密钥保存失败，请重试'));}
   finally{if(!disposed)save.disabled=false;}
  });save.disabled=true;
  entry.append(input,reveal,save);controls.append(entry,status);row.append(label,controls);
  const ready=this.weread.credentials().then(saved=>{if(disposed)return;input.value=saved.key||'';input.disabled=false;save.disabled=false;status.textContent=!saved.key?'':saved.verification==='verified'?'接口已验证':saved.verification==='failed'?'接口验证未通过':'已保存，尚未验证';}).catch(()=>{status.textContent='密钥读取失败，请重新打开设置';throw Error('密钥读取失败');});
  void ready.catch(()=>{});input.addEventListener('input',()=>{status.textContent='未保存';});
  return{row,input,status,ready,verify:async()=>{try{await ready;if(disposed)return;const saved=await this.weread.credentials();await validate(saved.key);}catch{}},dispose(){if(disposed)return;disposed=true;input.value='';input.type='password';}};

 },
 thoughtStatus(cache){modal('想法同步状态',body=>{body.append(el('p','',cache.status||'尚未同步'),el('p','yr-muted',`已获取 ${cache.downloaded||0} 条 · 已匹配 ${cache.matched||0} 条 · 未匹配 ${cache.unmatched||0} 条`));if(cache.error)body.append(el('p','yr-muted',cache.error));});},
 chooseWeRead(books){return new Promise(resolve=>{let chosen=false;const dialog=modal('关联微信读书书籍',(body,footer,close)=>{if(!books.length)body.append(el('p','','没有找到匹配的书籍。'));for(const b of books)body.append(button(b.title+' · '+(b.author||''),()=>{chosen=true;resolve(b);close();}));});dialog.addEventListener('close',()=>{if(!chosen)resolve(null);});});},
 async syncThoughts(book,force=false){await this.weread.sync(book,books=>this.chooseWeRead(books),force);await this.weread.anchor(book);if(this.current?.id===book.id&&this.library.config.weread)for(const{doc,index}of this.view.renderer.getContents())if(doc)await this.weread.render(this,doc,index);},
 showThoughts(book,item){modal('书友想法',(body,footer)=>{body.append(el('blockquote','',item.markText));const list=el('div');body.append(list);let more;const render=()=>{if(more)more.hidden=!item.hasMore;list.replaceChildren();for(const r of item.reviews||[]){const review=r.review||r;list.append(el('p','',review.content||''));}if(!item.reviews?.length)list.append(el('p','yr-muted','此划线暂无可获取的想法。'));};render();if(item.hasMore){more=button('查看更多',async()=>{more.disabled=true;try{await this.weread.more(book,item);render();}finally{more.disabled=false;}});footer.append(more);}});},
 async deleteBook(book){const accepted=await new Promise(resolve=>{const d=modal('删除《'+book.title+'》？',(body,footer,close)=>{body.append(el('p','','将永久删除书房里的副本、阅读进度、书签、划线和本地缓存。导入前的原文件和已另存到思源的摘录会保留。'));footer.append(button('删除书籍',()=>{resolve(true);close();}));});d.addEventListener('close',()=>resolve(false));});if(!accepted)return false;if(this.current?.id===book.id){await this.flush();await this.closeBook();}await this.library.remove(book);this.shelf();return true;},
};
