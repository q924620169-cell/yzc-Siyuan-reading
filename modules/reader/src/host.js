/** Host integration lives here; active tool state is independent from hidden native tabs. */
import{inheritAccent}from'./dom.js';
export class HostIntegration {
  constructor(plugin,getActiveTab) { this.plugin=plugin; this.getActiveTab=getActiveTab; this.active=false; this.highlighted=new Set(); }
  get dock(){return window.siyuan?.layout?.leftDock;}
  visible(){const d=this.dock;return !!d&&d.panelVisible!==false&&d.layout.element.getBoundingClientRect().width>0;}
  async toggleFromActivity(){
    const button=document.querySelector(`#dockLeft [data-type="${CSS.escape(this.plugin.dockType)}"]`);
    if(this.plugin.isRoomTab(this.getActiveTab())&&button?.classList.contains('dock__item--active')&&this.visible()){
      // Use the same model toggle as native Document/Outline buttons: no leftover divider.
      this.dock.toggleModel(this.plugin.dockType,false,true);this.syncCounter();return;
    }
    this.requestVisible=true;await this.plugin.open();
  }
  select(type,visible=this.visible()) {
    const button=document.querySelector(`#dockLeft [data-type="${CSS.escape(type)}"]`);
    if(!button)return;
    // show=true makes this idempotent even if another tool already selected this Dock.
    this.dock?.toggleModel(type,true);
    if(!visible&&this.dock?.panelVisible)this.dock.togglePanel(false);
  }
  setActive(active){
    const selected=document.querySelector('#dockLeft .dock__item--active')?.dataset.type;
    if(active&&!this.active&&selected&&selected!==this.plugin.dockType)this.previous=selected;
    this.active=active;
    const visible=this.requestVisible??this.transitionVisible??this.visible();
    if(active)this.select(this.plugin.dockType,visible);
    else if(selected===this.plugin.dockType)this.select(this.previous||'file',visible);
    if(!visible&&this.dock?.panelVisible)this.dock.togglePanel(false);
    this.requestVisible=undefined;this.transitionVisible=undefined;this.syncCounter();
  }
  beginTransition=event=>{if(event.isTrusted&&event.target.closest?.('.yzc-window-strip [role=tab]'))this.transitionVisible=this.visible();};
  syncCounter(){
    if(this.plugin.closed)return;
    inheritAccent(this.plugin.ui.root);inheritAccent(this.plugin.ui.sidebar);
    const surface=getComputedStyle(this.plugin.ui.sidebar).backgroundColor.match(/[\d.]+/g)?.map(Number);const scheme=surface&&surface.length>=3&&(.2126*surface[0]+.7152*surface[1]+.0722*surface[2])<128?'dark':'light';if(this.plugin.ui.sidebar.dataset.yrScheme!==scheme)this.plugin.ui.sidebar.dataset.yrScheme=scheme;
    const reader=this.plugin.ui.root.isConnected&&this.plugin.ui.root.checkVisibility();
    const rss=[...document.querySelectorAll('.rss-tab')].some(e=>e.checkVisibility());
    const tab=this.getActiveTab(),panel=tab?.panelElement;
    this.plugin.reading?.sync();
    const room=this.plugin.isRoomTab(tab);
    const pluginPage=panel
      ? panel.contains(this.plugin.ui.root)||panel.matches('.rss-tab')||!!panel.querySelector('.rss-tab')
      : reader||rss;
    document.documentElement.toggleAttribute('data-yzc-reader-active',!!reader||room);
    document.documentElement.toggleAttribute('data-yzc-reader-plugin-page',pluginPage||room);
    for(const [type,on]of[[this.plugin.dockType,reader||room],[this.plugin.name+'rss-navigation',rss]]){const item=document.querySelector(`#dockLeft [data-type="${type}"]`);if(item){const focused=!!on&&item.classList.contains('dock__item--active');if(item.classList.contains('dock__item--activefocus')!==focused){item.classList.toggle('dock__item--activefocus',focused);if(focused)this.highlighted.add(item);else this.highlighted.delete(item);}}}
  }
  dispose(){for(const item of this.highlighted)item.classList.remove('dock__item--activefocus');this.highlighted.clear();delete document.documentElement.dataset.yzcReaderActive;delete document.documentElement.dataset.yzcReaderPluginPage;}
}
