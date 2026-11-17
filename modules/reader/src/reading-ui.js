import{el,button,modal,report}from'./dom.js';import{safeAsset}from'./model.js';import{settingRow}from'./controls.js';
import{sizeReadingHeader}from'./reading-header.js';
import{compare,collapse}from'../vendor/foliate-js/epubcfi.js';
/** Finish queued background/font layout before closing the public view. */
export async function releaseReadingView(view,book){
 if(!view){book?.destroy();return;}
 const documents=view.renderer?.getContents().map(content=>content.doc).filter(Boolean)||[];
 if(documents.length){
  await Promise.allSettled(documents.map(doc=>doc.fonts?.ready));
  await new Promise(resolve=>requestAnimationFrame(resolve));
 }
 try{view.close();}finally{view.remove();book?.destroy();}
}
export function currentBookmark(bookmarks,location){
 if(!location?.cfi)return;
 return bookmarks?.find(bookmark=>{
  if(bookmark.unresolved)return false;
  if(bookmark.cfi===location.cfi)return true;
  try{return compare(collapse(bookmark.cfi,true),collapse(location.cfi))>=0&&compare(collapse(bookmark.cfi),collapse(location.cfi,true))<=0;}catch{return false;}
 });
}
export const readingMethods={
 paintBookmark(){
  const button=this.bookmarkButton;if(!button?.isConnected)return;
  const active=!!currentBookmark(this.state?.bookmarks,this.state?.location),label=active?'取消当前书签':'添加书签';
  button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',label);button.title=label;
 },
 async enter(){if(this.entering)return this.entering;if(!this.entryPending||!this.ready||!this.hostReady)return;this.entering=(async()=>{await this.detaching;if(!await this.waitForReadingLayout())return;const saved=this.library.config.lastSession;this.entryPending=false;if(this.library.config.positionLock&&saved){this.filter=saved.filter||'all';this.query=saved.query||'';this.shelfPositions=new Map(saved.positions||[]);if(saved.view==='book'){const book=this.library.books.find(b=>b.id===saved.bookID);if(book){await this.read(book,saved.articleID);return;}}}else{this.filter='all';this.query='';this.shelfPositions=new Map();}this.shelf();await this.refreshShelf();})().finally(()=>{this.entering=undefined;this.rememberSession();});return this.entering;},
 waitForReadingLayout(){const ready=()=>this.root.isConnected&&this.root.clientWidth>0&&this.root.clientHeight>0&&this.root.checkVisibility();if(ready())return Promise.resolve(true);return new Promise(resolve=>{const size=new ResizeObserver(check),mount=new MutationObserver(check);const done=value=>{size.disconnect();mount.disconnect();this.layoutWait=undefined;resolve(value);};function check(){if(ready())done(true);}this.layoutWait={cancel:()=>done(false)};size.observe(this.root);mount.observe(document.querySelector('.layout__center')||document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style']});check();});},
 rememberSession(){if(this.entryPending||this.disposed||this.entering)return;if(!this.current&&!this.database&&this.shelfArea?.isConnected){this.shelfPositions??=new Map();this.shelfPositions.set(this.filter+'|'+this.query,this.shelfArea.scrollTop);}const next={view:this.current?'book':'shelf',bookID:this.current?.id,articleID:this.course?.article.id,filter:this.filter,query:this.query,positions:[...(this.shelfPositions||new Map())]};if(JSON.stringify(this.library.config.lastSession)===JSON.stringify(next))return;this.library.config.lastSession=next;clearTimeout(this.sessionTimer);this.sessionTimer=setTimeout(()=>this.library.saveConfig().catch(()=>{}),500);},
 bookHeading(){const heading=el('div','yr-book-heading');if(safeAsset(this.current.cover)&&!this.current.cover.includes('/generated-cover')){const cover=el('img','yr-book-thumbnail');cover.src='/'+this.current.cover;cover.alt=this.current.title;heading.append(cover);}heading.append(el('h3','yr-book-name',this.current.title));return heading;},
 settings(){
  this.popover?.close();this.wakeCursor();let key,dismiss;
  const dialog=modal('书房设置',(body,footer,close)=>{
   dismiss=close;footer.remove();body.classList.add('yr-settings');
   const position=settingRow('位置锁定','启动时在上次打开的位置',!!this.library.config.positionLock),cursor=settingRow('自动隐藏光标','静止片刻后隐藏',!!this.library.config.autoHideCursor),weread=settingRow('连接微信读书','按需同步书友想法，优先读取本地缓存',!!this.library.config.weread);
   key=this.wereadSettings();
   const group=el('div','yr-settings-group'),extension=el('div','yr-settings-group');group.append(position.row,cursor.row);extension.append(weread.row,key.row);
   body.append(el('div','yr-settings-heading','阅读'),group,el('div','yr-settings-heading','扩展'),extension);
   for(const [control,name]of[[position,'positionLock'],[cursor,'autoHideCursor'],[weread,'weread']])control.input.addEventListener('change',()=>{
    this.library.config[name]=control.input.checked;this.rememberSession();this.wakeCursor();
    void this.library.saveConfig().catch(()=>{key.status.textContent='设置保存失败，请重新切换重试';report(Error('书房设置保存失败，请重试'));});
    if(name==='weread'){
     for(const{doc,index}of this.view?.renderer?.getContents()||[]){if(!doc)continue;doc.defaultView?.CSS?.highlights?.delete('yr-weread');if(control.input.checked)void this.weread.render(this,doc,index).catch(()=>{});}
     if(control.input.checked)void key.verify();
    }
   });
  });
  let pressedOutside=false;
  const outside=e=>{const r=dialog.getBoundingClientRect();return e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom);};
  dialog.addEventListener('pointerdown',e=>{pressedOutside=outside(e);});
  dialog.addEventListener('click',e=>{if(pressedOutside&&outside(e))dismiss();pressedOutside=false;});
  dialog.addEventListener('close',()=>{key.dispose();this.wakeCursor();},{once:true});
 },
 setupReadingChrome(){this.clearReadingChrome();const abort=this.chromeAbort=new AbortController();this.root.classList.add('yr-reading');this.root.classList.add('yr-chrome-top','yr-chrome-bottom');const header=this.root.querySelector('.yr-reader-header'),back=header.querySelector('.yr-reading-back'),tools=header.querySelector('.yr-tools');this.headerSizeCleanup=sizeReadingHeader(header,back,tools);const show=(which,on)=>{clearTimeout(this[which+'ChromeTimer']);if(on)this.root.classList.add('yr-chrome-'+which);else this[which+'ChromeTimer']=setTimeout(()=>{if(!this.root.querySelector((which==='top'?'.yr-reader-header':'.yr-progress')+':focus-within'))this.root.classList.remove('yr-chrome-'+which);},650);};
 this.root.addEventListener('pointermove',e=>{const r=this.root.getBoundingClientRect();show('top',e.clientY-r.top<64);show('bottom',r.bottom-e.clientY<64);this.wakeCursor();},{signal:abort.signal});
 this.root.addEventListener('pointerleave',()=>{show('top',false);show('bottom',false);this.wakeCursor(false);},{signal:abort.signal});
 for(const[selector,which]of[['.yr-reader-header','top'],['.yr-progress','bottom']]){const node=this.root.querySelector(selector);node?.addEventListener('focusin',()=>show(which,true),{signal:abort.signal});node?.addEventListener('focusout',()=>show(which,false),{signal:abort.signal});}
 show('top',false);show('bottom',false);this.wakeCursor();
 },
 bindReadingDocument(doc){const signal=this.chromeAbort.signal;doc.addEventListener('pointermove',e=>{this.wakeCursor();const iframe=doc.defaultView.frameElement;const y=e.clientY+(iframe?.getBoundingClientRect().top||this.view.getBoundingClientRect().top),r=this.root.getBoundingClientRect();for(const which of['top','bottom']){clearTimeout(this[which+'ChromeTimer']);const close=which==='top'?y-r.top<64:r.bottom-y<64;if(close)this.root.classList.add('yr-chrome-'+which);else this[which+'ChromeTimer']=setTimeout(()=>this.root.classList.remove('yr-chrome-'+which),650);}},{signal});doc.addEventListener('pointerdown',()=>this.wakeCursor(),{signal});doc.addEventListener('keydown',()=>this.wakeCursor(),{signal});},
 wakeCursor(schedule=true){clearTimeout(this.cursorTimer);this.setCursorHidden(false);if(schedule&&this.current&&this.library.config.autoHideCursor)this.cursorTimer=setTimeout(()=>{if(this.current&&this.root.checkVisibility()&&!document.querySelector('.yr-dialog[open]')&&!this.root.querySelector('.yr-reader-header:hover,.yr-progress:hover'))this.setCursorHidden(true);},3000);},
 setCursorHidden(hidden){this.root.classList.toggle('yr-cursor-hidden',hidden);for(const {doc}of this.view?.renderer?.getContents()||[])doc?.documentElement?.classList.toggle('yr-cursor-hidden',hidden);},
 clearReadingChrome(){this.chromeAbort?.abort();this.headerSizeCleanup?.();this.headerSizeCleanup=undefined;for(const key of['topChromeTimer','bottomChromeTimer','cursorTimer'])clearTimeout(this[key]);this.setCursorHidden(false);this.root.classList.remove('yr-reading','yr-chrome-top','yr-chrome-bottom');},
};
