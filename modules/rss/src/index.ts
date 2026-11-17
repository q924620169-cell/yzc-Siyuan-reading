import {getActiveTab,getAllTabs,openTab,showMessage,type Custom} from 'siyuan';
import {Repository} from './storage';
import {kernelClient,RemoteClient,pluginDataIO} from './kernel';
import {ImageCache} from './cache';
import {RssService} from './service';
import {Inbox} from './inbox';
import {permanentCover} from './assets';
import {BridgeClient} from './bridge';
import {RssView} from './ui/view';
import {DockNavigation,rssCounterActive} from './host';
import {IndexTranslator,TranslationService,translatedContent} from './translation';
import {readerHtml} from './ui/reader-format';

import {ModuleContext} from '../../../shared/module-context';
export default class YzcRss extends ModuleContext {
  private stop=new AbortController();
  private repo?:Repository;
  private service?:RssService;
  private translation?:TranslationService;
  private cache?:ImageCache;
  private bridge?:BridgeClient;
  private view?:RssView;
  private dock?:DockNavigation;
  private dockId='';
  private tab?:Custom;
  private opening?:Promise<void>;
  private timer?:ReturnType<typeof setInterval>;
  private widthTimer?:ReturnType<typeof setInterval>;
  private closed=false;
  private active=false;
  private layoutReady=false;
  private tabType='rss-reader';
  private message=(text:string,error=false):void=>{if(!this.closed)showMessage(`RSS：${text}`,error?8000:4000,error?'error':'info');};
  private report=(error:unknown)=>this.message(error instanceof Error?error.message:String(error),true);
  async onload():Promise<void>{
    const self=this;
    this.addIcons('<symbol id="iconYzcRss" viewBox="0 0 24 24"><circle cx="5" cy="19" r="1.6"/><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></symbol>');
    // Register custom model before any persisted host tab can be restored.
    this.addTab({type:this.tabType,
      init(){
        const previous=self.tab;self.tab=this;self.view?.attach(this.element as HTMLElement);
        if(previous&&previous!==this)queueMicrotask(()=>previous.tab.parent.removeTab(previous.tab.id,false,false));
        // A host layout may contain an RSS tab from before INL was disabled.
        queueMicrotask(()=>{if(self.layoutReady&&!self.bridge?.current&&self.tab===this)self.closeReader();});
      },
      destroy(){if(self.tab===this){self.tab=undefined;self.view?.detach();self.updateCounter();}},
      resize(){self.view?.syncHost();},
    });
    this.repo=new Repository(pluginDataIO(this.stop.signal));
    try{await this.repo.load();}catch(error){this.report(error);return;}
    if(this.closed)return;
    const api=kernelClient(this.stop.signal),remote=new RemoteClient(api);
    this.service=new RssService(this.repo,remote);
    this.translation=new TranslationService(this.repo,new IndexTranslator(api,this.stop.signal));
    this.translation.connect(this.service);
    this.cache=new ImageCache(this.repo,remote,api,this.stop.signal);
    const inbox=new Inbox(this.repo,this.service,api,()=>this.bridge?.current,permanentCover(this.cache,this.stop.signal),async(article,body)=>{
      const result=await this.translation!.translate(article,body,undefined,'inbox');
      if(result.cache.state!=='ready'||result.plan.units.some(u=>result.cache.parts[u.id]===undefined))throw new Error('中文正文尚未完整翻译，未创建 未分类文档，请稍后重试。');
      const content=translatedContent(result,false);return{title:content.title,html:readerHtml(content.html)};
    });
    this.view=new RssView({repo:this.repo,service:this.service,cache:this.cache,inbox,translation:this.translation,
      bridge:()=>this.bridge?.current,message:this.message,reschedule:()=>this.reschedule()});
    document.addEventListener('click',event=>{
      const target=event.target as Element;
      const button=target.closest<HTMLElement>('#dockLeft [data-type]');
      if(event.isTrusted&&button?.dataset.type===this.name+this.dockId){
        event.preventDefault();event.stopImmediatePropagation();
        queueMicrotask(()=>{if(!this.closed)try{this.dock?.toggleFromActivity(this.active,()=>this.bridge?.open());}catch(error){this.report(error);}});
      }
    },{capture:true,signal:this.stop.signal});
    this.bridge=new BridgeClient({
      id:'yzc-RSS',title:'RSS',
      isActive:()=>!!this.tab && getActiveTab()?.id===this.tab.tab.id,
      open:()=>this.openReader(),
      close:()=>this.closeReader(),
      active:value=>{this.active=value;this.dock?.setActive(value);this.updateCounter();},
      reselect:()=>this.view?.reselect(),
    },available=>this.setAvailable(available));
    this.bridge.connect();
    if(this.tab)this.view.attach(this.tab.element as HTMLElement);
    this.eventBus.on('ws-main',this.hostChange);
    this.eventBus.on('switch-protyle',this.hostChange);
    void this.cache.trim().catch(this.report);
  }
  onLayoutReady():void{
    this.layoutReady=true;
    // All plugins receive layout-ready before this microtask; allow INL's bridge to mount first.
    queueMicrotask(()=>{if(!this.closed&&!this.bridge?.current)this.closeReader();});
  }
  async onDataChanged():Promise<void>{
    if(this.closed||!this.repo)return;
    const minutes=this.repo.state.settings.refreshMinutes;
    await this.repo.reload();
    if(this.repo.state.settings.refreshMinutes!==minutes)this.reschedule();
  }
  private setAvailable(available:boolean):void{
    clearInterval(this.timer);clearInterval(this.widthTimer);
    if(this.closed)return;
    if(!available){
      if(this.layoutReady)this.closeReader();this.dock?.dispose();this.dock=undefined;
      if(this.dockId){this.removeDock(this.dockId);this.dockId='';}
      const command=this.commands.findIndex(c=>c.langKey==='openRss');
      if(command>=0)this.commands.splice(command,1);
      return;
    }
    if(!this.dockId){
      const self=this;
      const dock=this.addDock({
        type:'rss-navigation',config:{position:'LeftTop',size:{width:304,height:0},icon:'iconYzcRss',title:'RSS 阅览室',show:false},
        data:{},
        init(){this.element.classList.add('rss-dock');this.element.append(self.view!.sidebar);},
      });
      if(!dock)throw Error('无法注册 RSS 导航');
      this.dockId=dock.id;this.dock=new DockNavigation(this.name+dock.id);
      if(this.active)this.dock.setActive(true);
      this.addCommand({langKey:'openRss',langText:'打开 RSS 阅览室',callback:()=>{try{this.dock?.open(()=>this.bridge?.open());}catch(e){this.report(e);}}});
    }
    this.widthTimer=setInterval(()=>this.hostChange(),750);
    this.reschedule();
  }
  private updateCounter(active?:boolean):void{
    const focused=getActiveTab();
    const nativeRssActive=focused?!!this.tab&&focused.id===this.tab.tab.id:undefined;
    active??=rssCounterActive(!!this.bridge?.current,this.active,nativeRssActive);
    if(active&&!this.closed)document.documentElement.dataset.yzcRssActive='true';
    else delete document.documentElement.dataset.yzcRssActive;
  }
  private hostChange=():void=>{this.view?.syncHost();this.updateCounter();};
  private reschedule():void{
    if(this.timer)clearInterval(this.timer);
    const minutes=this.repo?.state.settings.refreshMinutes??0;
    if(minutes>0&&this.bridge?.current)this.timer=setInterval(()=>void this.service?.refresh().catch(this.report),minutes*60000);
  }
  private async openReader():Promise<void>{
    if(this.closed||!this.bridge?.current)return;
    if(this.opening)return this.opening;
    this.opening=(async()=>{
      if(this.tab&&(this.tab.element as HTMLElement).isConnected){
        this.tab.tab.parent.switchTab(this.tab.tab.headElement);this.view?.syncHost();return;
      }
      const tab=await openTab({app:this.app,custom:{id:this.name+this.tabType,title:'RSS',icon:'iconYzcRss'},openNewTab:false,removeCurrentTab:false});
      if(this.closed||!this.bridge?.current){tab?.parent.removeTab(tab.id,false,false);return;}
      this.view?.syncHost();
    })().finally(()=>{this.opening=undefined;});
    return this.opening;
  }
  private closeReader():void{
    for(const tab of getAllTabs(this.name+this.tabType))tab.parent.removeTab(tab.id,false,false);
    if(this.tab){this.tab.tab.parent.removeTab(this.tab.tab.id,false,false);this.tab=undefined;}
    this.view?.detach();this.active=false;this.dock?.setActive(false);
    this.updateCounter(false);
  }
  openSetting():void{
    if(!this.bridge?.current)return;
    try{this.dock?.open(()=>this.bridge?.open());this.view?.settings();}catch(error){this.report(error);}
  }
  onunload():void{
    if(this.closed)return;this.closed=true;
    this.stop.abort();clearInterval(this.timer);clearInterval(this.widthTimer);
    this.eventBus.off('ws-main',this.hostChange);this.eventBus.off('switch-protyle',this.hostChange);
    this.bridge?.dispose();this.closeReader();this.dock?.dispose();
    if(this.dockId)this.removeDock(this.dockId);
    this.translation?.dispose();this.view?.dispose();this.service?.dispose();this.cache?.dispose();this.repo?.dispose();
  }
}
