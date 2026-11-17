/** The bridge can retain its tool selection while SiYuan focuses another tab. */
export function rssCounterActive(bridgeAvailable:boolean,toolActive:boolean,nativeRssActive:boolean|undefined):boolean{
  return bridgeAvailable?toolActive&&nativeRssActive!==false:nativeRssActive===true;
}
/** Native dock layout is owned by SiYuan, including its hidden resize handle. */
interface HostDock {
  layout:{element:HTMLElement};panelVisible?:boolean;
  toggleModel(type:string,show?:boolean,close?:boolean):void;
  togglePanel?(show:boolean):void;
}
/** Host dock integration stays here; no INL private DOM access. */
export class DockNavigation {
  private previous?:string;
  private active=false;
  private requestVisible?:boolean;
  constructor(readonly type:string){const selected=document.querySelector<HTMLElement>('#dockLeft .dock__item--active');if(selected?.dataset.type!==type)this.previous=selected?.dataset.type;}
  private button(type:string):HTMLElement|null{return document.querySelector(`#dockLeft [data-type="${CSS.escape(type)}"]`);}
  private get dock():HostDock|undefined{return window.siyuan?.layout?.leftDock as HostDock|undefined;}
  visible():boolean{const dock=this.dock;return !!dock&&dock.panelVisible!==false&&dock.layout.element.getBoundingClientRect().width>0;}
  /** Only an explicit activity/command/settings entry requests reopening the sidebar. */
  open(openReader:()=>void):void{this.requestVisible=true;try{openReader();this.setActive(true);}finally{this.requestVisible=undefined;}}
  toggleFromActivity(readerActive:boolean,openReader:()=>void):void{
    if(readerActive&&this.button(this.type)?.classList.contains('dock__item--active')&&this.visible()){
      this.dock?.toggleModel(this.type,false,true);return;
    }
    this.open(openReader);
  }
  private select(type:string,visible:boolean):void{
    const button=this.button(type);if(!button)return;
    const dock=this.dock;
    if(dock){
      dock.toggleModel(type,true);
      // New hosts expose panel visibility separately. Older hosts can close the model.
      if(!visible){if(dock.togglePanel)dock.togglePanel(false);else dock.toggleModel(type,false,true);}
    }else if(!button.classList.contains('dock__item--active'))button.click();
  }
  setActive(active:boolean):void{
    const wasActive=this.active;this.active=active;
    const visible=this.requestVisible??this.visible();
    if(active){
      const selected=document.querySelector<HTMLElement>('#dockLeft .dock__item--active');
      if(!wasActive&&selected?.dataset.type&&selected.dataset.type!==this.type)this.previous=selected.dataset.type;
      this.select(this.type,visible);
    }else{
      const button=this.button(this.type);
      if(button?.classList.contains('dock__item--active')){
        this.select(this.previous&&this.button(this.previous)?this.previous:'file',visible);
      }
    }
  }
  dispose():void{this.setActive(false);}
}
