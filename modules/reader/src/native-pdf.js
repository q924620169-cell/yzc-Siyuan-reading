import{button,el}from'./dom.js';
import{prepareScanRendering}from'./pdf-scan-rendering.js';
import{sizeReadingHeader}from'./reading-header.js';

// The host layout serializer reads pdfObject.page before checking pdfViewer.
// Wait for the host's own initialization before a programmatic tab handoff.
export async function waitForPDFLayout(getTabs,signal){
 const deadline=performance.now()+3000;
 while(getTabs().some(tab=>tab.model?.pdfObject&&!tab.model.pdfObject.pdfViewer)){
  if(signal.aborted)return;
  if(performance.now()>deadline)throw Error('思源 PDF 阅读器仍在初始化，请稍后重试');
  await new Promise(resolve=>setTimeout(resolve,25));
 }
}

export async function waitForPDFTab(tab,signal){
 const deadline=performance.now()+20000;
 while(tab.panelElement.isConnected&&!signal.aborted){
  if(tab.model?.pdfObject?.isInitialViewSet&&tab.model.pdfObject.pdfViewer&&!tab.model.element.hasAttribute('data-loading'))return true;
  if(performance.now()>deadline)throw Error('PDF 尚未完成初始化，请稍后重试定位');
  await new Promise(resolve=>setTimeout(resolve,25));
 }
 return false;
}

/** SiYuan 3.8.10 compatibility boundary. Native asset tabs own their PDF.js instance. */
export class NativePDF{
 constructor(tab,options){
  this.tab=tab;this.options=options;this.title=tab.title;
  this.stop=new AbortController();
  options.signal.addEventListener('abort',()=>this.dispose(),{once:true,signal:this.stop.signal});
 }
 sync(active,maximized){
  const panel=this.tab.panelElement,pdf=this.tab.model?.pdfObject;
  this.active=active;
  if(!panel.isConnected){this.dispose();return;}
  if(this.pdf&&this.pdf!==pdf){
   this.unmount();
   this.restoreScan?.();
   this.pdf.eventBus.off('scalechanging',this.onScale);
   this.pdf=undefined;this.onScale=undefined;this.initialized=false;
  }
  if(!this.pdf&&pdf?.eventBus&&pdf.pdfViewer){
   this.pdf=pdf;this.restoreScan=prepareScanRendering(pdf,this.options.signal);
   this.onScale=()=>{
    if(this.initialized&&this.active&&!this.applyingZoom&&performance.now()<this.zoomIntentUntil)
     this.options.zoomChanged(pdf.pdfViewer.currentScaleValue);
   };
   pdf.eventBus.on('scalechanging',this.onScale);
  }
  const ready=pdf?.isInitialViewSet&&!this.tab.model.element?.hasAttribute('data-loading');
  if(active&&ready){
   if(!this.initialized){
    this.initialized=true;
    this.applyingZoom=true;
    pdf.pdfViewer.currentScaleValue=this.options.zoom.mode==='percent'?this.options.zoom.scale:this.options.zoom.mode;
    this.applyingZoom=false;
   }
   const mounted=this.mounted;
   this.mount();
   if(!mounted||this.requestedMax!==maximized){this.requestedMax=maximized;this.setMaximized(maximized);}
  }else this.unmount();
 }
 mount(){
  if(this.mounted)return;
  const panel=this.tab.panelElement,toolbar=panel.querySelector('#toolbarViewer'),outer=panel.querySelector('.pdf__outer');
  const scale=panel.querySelector('#scaleSelect'),maximize=panel.querySelector('#pdfMaximize'),more=panel.querySelector('#secondaryToolbarToggleButton');
  if(!toolbar||!outer||!scale||!maximize||!more)return;
  this.mounted=true;this.outer=outer;this.maximize=maximize;
  panel.classList.add('yr-native-pdf');
  const ui=this.options.ui;
  const back=button('返回书架',()=>ui.back(),'iconBack');back.append(el('span','','返回书架'));back.classList.add('yr-reading-back');
  back.addEventListener('click',event=>event.stopPropagation());
  const title=el('span','yr-pdf-title',ui.course?.article.title||ui.current.title);title.title=title.textContent;
  const settings=button('书房设置',()=>ui.settings(),'iconSettings');settings.classList.add('toolbarButton');
  settings.addEventListener('click',event=>event.stopPropagation());
  const tools=el('div','yr-tools yr-pdf-tools'),search=button('搜索当前书籍',()=>this.find(),'iconSearch');
  search.addEventListener('click',event=>event.stopPropagation());
  this.controls=[scale.parentElement,maximize,more].map(node=>{
   const slot=document.createComment('book room control');node.before(slot);return{node,slot};
  });
  tools.append(scale.parentElement,maximize,search,settings,more);
  toolbar.prepend(back,title);toolbar.append(tools);this.header=[back,title,tools];
  this.headerSizeCleanup=sizeReadingHeader(toolbar,back,tools);
  this.tab.updateTitle('书房');
  const stop=this.mountStop=new AbortController(),signal=stop.signal;
  const intent=()=>this.zoomIntentUntil=performance.now()+600;
  scale.addEventListener('change',intent,{capture:true,signal});
  outer.addEventListener('wheel',event=>{if(event.ctrlKey)intent();},{capture:true,passive:true,signal});
  outer.addEventListener('keydown',event=>{if(['+','-','=','0'].includes(event.key)&&(event.ctrlKey||event.metaKey))intent();},{capture:true,signal});
  this.maxObserver=new MutationObserver(()=>{
   if(this.active&&!this.settingMax){
    this.requestedMax=maximize.getAttribute('aria-pressed')==='true';
    this.options.maximizeChanged(this.requestedMax);
   }
  });
  this.maxObserver.observe(maximize,{attributes:true,attributeFilter:['aria-pressed']});
  if(ui.course){
   const {order,article}=ui.course,index=order.findIndex(a=>a.id===article.id);
   const footer=this.footer=el('footer','yr-progress yr-pdf-progress');
   const previous=button('上一篇',()=>ui.switchArticle(order[index-1]?.id),'iconLeft');previous.disabled=index===0;
   const next=button('下一篇',()=>ui.switchArticle(order[index+1]?.id),'iconRight');next.disabled=index===order.length-1;
   footer.append(previous,el('span','',`${index+1} / ${order.length} 篇`),next);outer.append(footer);
   footer.addEventListener('click',event=>event.stopPropagation(),{signal});
   panel.classList.add('yr-pdf-course');
  }
  const wake=()=>{
   clearTimeout(this.cursorTimer);outer.classList.remove('yr-pdf-cursor-hidden');
   if(ui.library.config.autoHideCursor)this.cursorTimer=setTimeout(()=>{
    if(this.active&&!toolbar.matches(':hover,:focus-within'))outer.classList.add('yr-pdf-cursor-hidden');
   },3000);
  };
  outer.addEventListener('pointermove',wake,{signal});outer.addEventListener('pointerdown',wake,{signal});
  outer.addEventListener('keydown',wake,{signal});
  const keepTop=()=>toolbar.matches(':hover,:focus-within')||more.getAttribute('aria-expanded')==='true'||panel.querySelector('#viewFindButton')?.getAttribute('aria-expanded')==='true';
  const show=(which,visible)=>{
   clearTimeout(this[which+'ChromeTimer']);
   if(visible)outer.classList.add('yr-chrome-'+which);
   else this[which+'ChromeTimer']=setTimeout(()=>{
    if(which==='top'?keepTop():this.footer?.matches(':hover,:focus-within'))return;
    outer.classList.remove('yr-chrome-'+which);
   },650);
  };
  outer.addEventListener('pointermove',event=>{
   const rect=outer.getBoundingClientRect();show('top',event.clientY-rect.top<64);show('bottom',rect.bottom-event.clientY<64);
  },{signal});
  outer.addEventListener('pointerleave',()=>{show('top',false);show('bottom',false);},{signal});
  toolbar.addEventListener('focusin',()=>show('top',true),{signal});
  toolbar.addEventListener('focusout',()=>show('top',false),{signal});
  outer.addEventListener('focusin',event=>{if(event.target.closest?.('#findbar'))show('top',true);},{signal});
  outer.addEventListener('focusout',()=>show('top',false),{signal});
  outer.addEventListener('keydown',event=>{
   if(event.key!=='Escape')return;
   const find=panel.querySelector('#viewFindButton');
   const popup=[...document.querySelectorAll('dialog[open],.yr-popover,.b3-menu:not(.fn__none):not(.fn__hidden):not(.hidden)')].some(node=>node.checkVisibility());
   let control;
   if(find?.getAttribute('aria-expanded')==='true')control=find;
   else if(more.getAttribute('aria-expanded')==='true')control=more;
   else if(maximize.getAttribute('aria-pressed')==='true'&&event.target.closest?.('#viewerContainer')&&!popup&&!panel.querySelector('.pdf__util:not(.fn__none)')&&document.getSelection()?.isCollapsed)control=maximize;
   if(control){
    event.preventDefault();event.stopPropagation();control.click();
   }
  },{capture:true,signal});
  this.footer?.addEventListener('focusin',()=>show('bottom',true),{signal});
  this.footer?.addEventListener('focusout',()=>show('bottom',false),{signal});
  outer.classList.add('yr-chrome-top','yr-chrome-bottom');show('top',false);show('bottom',false);
 }
 find(){this.tab.panelElement.querySelector('#viewFindButton')?.click();}
 setMaximized(value){
  const button=this.maximize;
  if(!button||button.disabled||(button.getAttribute('aria-pressed')==='true')===value)return;
  this.settingMax=true;button.click();queueMicrotask(()=>this.settingMax=false);
 }
 unmount(){
  if(!this.mounted)return;
  this.setMaximized(false);this.maxObserver.disconnect();this.mountStop.abort();
  this.headerSizeCleanup?.();
  this.tab.panelElement.querySelector('#toolbarViewer')?.style.removeProperty('--yr-reader-side');
  this.tab.panelElement.querySelector('#toolbarViewer')?.removeAttribute('data-compact');
  this.tab.panelElement.querySelector('#toolbarViewer')?.removeAttribute('data-narrow');
  for(const which of['top','bottom'])clearTimeout(this[which+'ChromeTimer']);
  this.outer.classList.remove('yr-chrome-top','yr-chrome-bottom');
  clearTimeout(this.cursorTimer);this.outer.classList.remove('yr-pdf-cursor-hidden');
  for(const{node,slot}of this.controls)slot.replaceWith(node);
  for(const node of this.header)node.remove();this.footer?.remove();
  this.tab.panelElement.classList.remove('yr-native-pdf','yr-pdf-course');
  if(this.tab.panelElement.isConnected)this.tab.updateTitle(this.title);
  this.mounted=false;this.maximize=undefined;
 }
 dispose(){
  this.active=false;this.unmount();this.stop.abort();
  this.restoreScan?.();this.restoreScan=undefined;
  if(this.onScale)this.pdf.eventBus.off('scalechanging',this.onScale);
  this.onScale=undefined;
 }
}
