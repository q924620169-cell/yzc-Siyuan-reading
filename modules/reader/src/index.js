import{Protyle,openTab,getActiveTab,getAllTabs,showMessage}from'siyuan';
import{Library}from'./storage.js';
import{ReaderUI}from'./ui.js';
import{HostIntegration}from'./host.js';
import{isOwnedPDFAsset}from'./owned-storage.js';
import{ReadingControls}from'./reading-controls.js';
import{waitForPDFLayout,waitForPDFTab}from'./native-pdf.js';
import {ModuleContext} from '../../../shared/module-context';
export default class Reader extends ModuleContext{
 async onload(){
  // A course directory click can leave keyboard focus in the dock.
  this.stop=new AbortController();this.library=new Library();this.closed=false;this.host=new HostIntegration(this,()=>getActiveTab(false));const self=this;
  this.addIcons('<symbol id="iconYzcLibrary" viewBox="0 0 24 24"><path d="M4 4v16M9 4v16M14 5l5 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></symbol><symbol id="iconYzcReader" viewBox="0 0 24 24"><path d="M3 4.5c3-1 6-1 9 1 3-2 6-2 9-1v15c-3-1-6-1-9 1-3-2-6-2-9-1zM12 5.5v15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></symbol>');
  document.addEventListener('yr:error',e=>showMessage('书房：'+e.detail,7000,'error'),{signal:this.stop.signal});
  this.ui=new ReaderUI(this.library,id=>openTab({app:this.app,doc:{id}}));
  this.reading=this.ui.controls=new ReadingControls(this);
  this.ui.openPDF=(path,page)=>this.openRoomPDF(path,page);
  this.ui.focusReader=()=>this.openReaderTab();
  this.ui.notify=(message,timeout)=>showMessage(message,timeout);
  this.ui.createDatabase=(element,options)=>new Protyle(this.app,element,options);
  this.addTab({type:'books',init(){const previous=self.tab;self.tab=this;self.ui.attach(this.element);if(previous&&previous!==this)previous.tab.parent.removeTab(previous.tab.id,false,false);},destroy(){if(self.tab===this){self.tab=undefined;if(!self.pdfTab)self.roomClosed();}},resize(){self.ui.syncTheme();}});
  const dock=this.addDock({type:'reading',config:{position:'LeftTop',size:{width:260,height:0},icon:'iconYzcReader',title:'书房',show:false},data:{},init(){this.element.classList.add('yr-dock');this.element.append(self.ui.sidebar);}});this.dockType=this.name+(dock.id||'reading');
  document.addEventListener('click',e=>{const target=e.target.closest?.('#dockLeft [data-type]');if(target?.dataset.type!==this.dockType||!e.isTrusted)return;e.preventDefault();e.stopImmediatePropagation();queueMicrotask(()=>this.host.toggleFromActivity().catch(this.report));},{capture:true,signal:this.stop.signal});
  this.eventBus.on('switch-protyle',this.hostChanged);this.eventBus.on('ws-main',this.hostChanged);
  document.addEventListener('pointerdown',this.host.beginTransition,{capture:true,signal:this.stop.signal});
  this.hostObserver=new MutationObserver(()=>{
   if(this.pdfTab&&!this.pdfTab.panelElement.isConnected){this.pdfTab=undefined;if(!this.tab)this.roomClosed();}
   this.host.syncCounter();
  });this.hostObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-yzc-rss-active','data-theme-mode','class','style','data-sv-theme','data-sv-style']});
  this.hostObserver.observe(document.head,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['href','media','disabled']});
  document.addEventListener('load',event=>{if(event.target instanceof HTMLLinkElement)this.host.syncCounter();},{capture:true,signal:this.stop.signal});
  const activity=document.querySelector('#dockLeft');if(activity)this.hostObserver.observe(activity,{subtree:true,attributes:true,attributeFilter:['class']});
  const center=document.querySelector('.layout__center');if(center)this.hostObserver.observe(center,{subtree:true,attributes:true,attributeFilter:['class','style','data-loading'],childList:true});
  this.addCommand({langKey:'openReader',langText:'打开书房',callback:()=>this.open()});
  document.addEventListener('yzc-inl:bridge-ready',e=>this.acceptBridge(e.detail),{signal:this.stop.signal});
  document.addEventListener('yzc-inl:bridge-offline',event=>{if(this.bridge&&event.detail!==this.bridge)return;this.unregister=undefined;this.bridge=undefined;this.setDock(this.isRoomTab(this.host.getActiveTab()));},{signal:this.stop.signal});
  document.dispatchEvent(new CustomEvent('yzc-inl:bridge-request',{detail:{accept:b=>this.acceptBridge(b)}}));
  try{await this.library.load();this.ui.ready=true;this.ui.shelf();}catch(e){this.report(e);}this.ready=true;
 }
 report=e=>showMessage('书房：'+(e.message||String(e)),8000,'error');
 acceptBridge(bridge){if(bridge.version!==1||this.bridge===bridge)return;this.unregister?.();this.bridge=bridge;this.unregister=bridge.register({id:'yzc-Reader',title:'书房',isActive:()=>this.isRoomTab(this.host.getActiveTab()),open:()=>this.openTab(),close:()=>this.closeTab(),active:active=>this.setDock(active),reselect:()=>{if(!this.ui.current)this.ui.shelf();}});}
 setDock(active){this.host.setActive(active);}
 hostChanged=()=>{this.ui.syncTheme();this.host.syncCounter();};
 onLayoutReady(){
  this.layoutReady=true;
  this.ui.hostReady=true;
  const active=this.host.getActiveTab();
  const restored=getAllTabs().filter(tab=>tab!==this.pdfTab&&tab.title==='书房'&&isOwnedPDFAsset(tab.model?.path));
  for(const tab of restored)tab.parent.removeTab(tab.id,false,false,false);
  this.host.syncCounter();
  if(restored.includes(active)&&!this.tab&&!this.pdfTab)void this.open().catch(this.report);
  else if(this.ui.root.isConnected)void this.ui.enter().catch(this.report);
 }
 async open(){for(let n=0;!this.layoutReady&&n<100;n++)await new Promise(r=>setTimeout(r,50));if(!this.layoutReady)throw Error('思源正在恢复页面，请稍后打开书房');this.host.requestVisible??=this.host.visible();if(this.bridge){this.bridge.open('yzc-Reader');this.setDock(true);}else{await this.openTab();this.setDock(true);}await this.openTab();await this.ui.enter();}
 isRoomTab(tab){return !!tab&&(tab===this.pdfTab||tab===this.tab?.tab);}
 async openTab(){
  if(this.closed)return;
  const pdf=this.pdfTab;
  if(pdf?.panelElement.isConnected){pdf.parent.switchTab(pdf.headElement);return pdf;}
  return this.openReaderTab();
 }
 async openReaderTab(){
  if(this.closed)return;
  if(this.opening)return this.opening;
  await waitForPDFLayout(getAllTabs,this.stop.signal);
  if(this.closed)return;
  if(this.opening)return this.opening;
  const previous=this.pdfTab;
  if(this.tab?.element.isConnected){const tab=this.tab.tab;tab.parent.switchTab(tab.headElement);return tab;}
  this.opening=openTab({app:this.app,custom:{id:this.name+'books',title:'书房',icon:'iconYzcReader'},openNewTab:false,removeCurrentTab:false})
   .then(tab=>{
    if(tab&&previous&&this.pdfTab===previous){
     this.pdfTab=undefined;
     previous.parent.removeTab(previous.id,false,false);
     if(this.host.getActiveTab()!==tab)tab.parent.switchTab(tab.headElement);
    }
    return tab;
   }).finally(()=>this.opening=undefined);
  return this.opening;
 }
 async openRoomPDF(path,page){
  const previous=this.pdfTab||this.tab?.tab;
  if(previous?.model?.path===path&&previous.panelElement.isConnected&&page===undefined){
   previous.parent.switchTab(previous.headElement);
   this.reading.bindPDF(previous);
   return previous;
  }
  const existing=getAllTabs().find(tab=>tab.model?.path===path);
  await waitForPDFLayout(getAllTabs,this.stop.signal);
  const tab=await openTab({app:this.app,pdf:{path},removeCurrentTab:false});
  if(!tab)throw Error('无法打开 PDF');
  if(this.closed||previous&&!this.isRoomTab(previous)){
   if(tab!==existing)tab.parent.removeTab(tab.id,false,false);
   throw Error('书房窗口已关闭');
  }
  this.pdfTab=tab;
  this.reading.bindPDF(tab);
  await waitForPDFLayout(getAllTabs,this.stop.signal);
  if(page!==undefined&&await waitForPDFTab(tab,this.stop.signal))await openTab({app:this.app,pdf:{path,page},removeCurrentTab:false});
  if(previous&&previous!==tab&&previous.panelElement.isConnected){
   previous.parent.removeTab(previous.id,false,false);
   if(this.host.active&&this.host.getActiveTab()!==tab)tab.parent.switchTab(tab.headElement);
  }
  return tab;
 }
 roomClosed(){void this.ui.detach();this.setDock(false);}
 closeTab(){
  const pdf=this.pdfTab;
  this.pdfTab=undefined;
  if(pdf?.panelElement.isConnected)pdf.parent.removeTab(pdf.id,false,false);
  const custom=getAllTabs(this.name+'books');
  for(const tab of custom)tab.parent.removeTab(tab.id,false,false);
  if(pdf&&!custom.length)this.roomClosed();
  else this.setDock(false);
 }
 openSetting(){this.ui.settings();}
 async onDataChanged(){if(this.closed)return;const shelf=this.ui.shelfArea;if(!this.ui.current&&!this.ui.database&&shelf?.isConnected){await this.ui.refreshShelf({load:()=>this.library.load()});if(!this.closed&&!this.ui.current&&!this.ui.database&&this.ui.shelfArea===shelf&&shelf.isConnected)this.ui.shelf();}else await this.library.load();}
 onunload(){this.closed=true;this.stop.abort();this.eventBus.off('switch-protyle',this.hostChanged);this.eventBus.off('ws-main',this.hostChanged);this.hostObserver?.disconnect();this.unregister?.();this.closeTab();this.ui.dispose();this.host.dispose();this.removeDock('reading');}
}
