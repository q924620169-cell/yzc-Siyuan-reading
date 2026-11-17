import { WindowModel, type WindowDocument, type WindowState } from '../windows/window-model';
import type { HostDocument, WindowHost } from './window-host';
import type { ToolWindow } from '../windows/tool-contract';

/** Owns navigation controls; native editors are opened/closed only through WindowHost. */
export class WindowAdapter {
  readonly model: WindowModel;
  private nav: HTMLElement;
  private strip: HTMLElement;
  private items = new Map<string, HTMLElement>();
  private empty: HTMLElement;
  private history?: HTMLElement;
  private observer: MutationObserver;
  private unsubscribe: () => void;
  private events: AbortController;
  private rows = new Set<HTMLElement>();
  private native?: HostDocument;
  private busy = false;
  private disposed = false;
  private queue: Promise<void> = Promise.resolve();
  private pointerDrag?: {key:string;pointerId:number;x:number;y:number;moved:boolean};
  private suppressClick = false;
  private fromTree = false;
  private tools=new Map<string,ToolWindow>();
  private listeners=new Set<()=>void>();
  private documentKey?:string;
  get activeSpace():string {return this.model.active.tool?.id || 'document';}
  hasTool(id:string):boolean {return this.tools.has(id);}
  subscribe(listener:()=>void):()=>void {this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  selectDocuments():void {
    const slot=this.model.state.slots.find(s=>s.key===(this.documentKey||this.model.state.documentActive)&&!s.tool)||this.model.state.slots.find(s=>!s.tool);
    if(slot)this.model.select(slot.key);else this.model.add('document-'+Date.now());
    this.activate();
    const button=this.doc.querySelector<HTMLElement>('#dockLeft [data-type="file"]');
    if(button&&!button.classList.contains('dock__item--active'))button.click();
  }
  private toolVisibility=new Map<string,boolean>();
  constructor(private host: WindowHost, raw: unknown, private save: (state: WindowState) => void, private report: (error: unknown) => void, private doc: Document = document) {
    this.model = new WindowModel(raw,host.active());
    this.events = new doc.defaultView!.AbortController();
    this.nav=doc.createElement('nav'); this.nav.className='yzc-windows'; this.nav.setAttribute('aria-label','窗口');
    // The host toolbar walks target.parentElement on click; closing removes the
    // target synchronously. Our controls own these clicks, so stop at the nav.
    this.nav.addEventListener('click',event=>event.stopPropagation(),{signal:this.events.signal});
    this.strip=doc.createElement('div'); this.strip.className='yzc-window-strip'; this.strip.setAttribute('role','tablist');
    const actions=doc.createElement('div'); actions.className='yzc-window-actions';
    const add=doc.createElement('button'); add.type='button'; add.className='yzc-window-add'; add.innerHTML='<svg aria-hidden="true"><use href="#iconAdd"></use></svg>'; add.setAttribute('aria-label','新增窗口');
    add.onclick=()=>{this.closeHistory();this.model.add(doc.defaultView!.crypto.randomUUID());this.changed();this.notifyTools();};
    const recent=doc.createElement('button'); recent.type='button'; recent.className='yzc-window-recent'; recent.innerHTML='<svg aria-hidden="true"><use href="#iconDown"></use></svg>'; recent.setAttribute('aria-label','最近浏览'); recent.setAttribute('aria-haspopup','menu');
    recent.onclick=()=>this.openHistory(recent);
    actions.append(add,recent);
    this.nav.append(this.strip,actions);
    this.empty=doc.createElement('div'); this.empty.className='yzc-window-empty'; this.empty.textContent='从文档树或最近记录中选择文档';
    this.native=host.active();
    if (!raw) for(const item of host.documents()) this.model.remember(item);
    // Convert pre-existing browsing tabs into recent entries. Documents stay intact.
    this.busy=true;
    for(const item of host.documents()) if(item.token !== this.native?.token) host.close(item);
    this.busy=false;
    this.unsubscribe=host.subscribe(this.onHostChange);
    this.observer=new doc.defaultView!.MutationObserver(() => this.mount());
    this.observer.observe(doc.body,{childList:true,subtree:true});
    doc.addEventListener('click',this.onClick,{capture:true,signal:this.events.signal});
    doc.addEventListener('keydown',this.onKey,{signal:this.events.signal});
    this.strip.addEventListener('pointerdown',this.onPointerDown,{signal:this.events.signal});
    this.strip.addEventListener('pointermove',this.onPointerMove,{signal:this.events.signal});
    this.strip.addEventListener('pointerup',this.onPointerUp,{signal:this.events.signal});
    this.strip.addEventListener('pointercancel',()=>{this.pointerDrag=undefined;},{signal:this.events.signal});
    this.strip.addEventListener('click',event=>{if(this.suppressClick){this.suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}},{capture:true,signal:this.events.signal});
    this.render();
    const target=this.model.active.document;
    if(target && target.id !== this.native?.id) this.browse(target);
    else this.changed();
  }
  private mount(): void {
    if(this.disposed) return;
    const wnd=this.doc.querySelector('.layout__center .layout__wnd--active') ?? this.doc.querySelector('.layout__center [data-type="wnd"]');
    // One persistent titlebar container; editor replacement never remounts it.
    const container=wnd?.querySelector<HTMLElement>(':scope > .layout-tab-container');
    const drag=this.doc.querySelector('#toolbar > #drag');
    if(drag && this.nav.nextElementSibling !== drag) drag.before(this.nav);
    for(const row of this.doc.querySelectorAll<HTMLElement>('.layout__center [data-type="wnd"] > .fn__flex:has(> .layout-tab-bar)')) {
      this.rows.add(row);
      const foreign=row.parentElement===wnd && this.foreign();
      if(foreign)row.setAttribute('data-yzc-native-tabs','');
      else row.removeAttribute('data-yzc-native-tabs');
    }
    this.nav.hidden=this.foreign();
    for(const old of this.doc.querySelectorAll('[data-yzc-window-empty]')) if(old !== container || this.model.active.document || this.model.active.tool) old.removeAttribute('data-yzc-window-empty');
    if(container && !this.model.active.document && !this.model.active.tool && !this.foreign()) {
      container.setAttribute('data-yzc-window-empty','');
      if(this.empty.parentElement !== container) container.append(this.empty);
    } else this.empty.remove();
  }
  private changed(): void { if(!this.model.active.tool){this.documentKey=this.model.state.active;this.model.state.documentActive=this.documentKey;}this.save(JSON.parse(JSON.stringify(this.model.state))); this.render();this.listeners.forEach(listener=>listener()); }
  private render(): void {
    const keys=new Set(this.model.state.slots.map(slot=>slot.key));
    for(const [key,item] of this.items)if(!keys.has(key)){item.remove();this.items.delete(key);}
    for(const [index,slot] of this.model.state.slots.entries()) {
      let item=this.items.get(slot.key);
      if(!item) {
      item=this.doc.createElement('div'); item.className='yzc-window'; item.dataset.windowKey=slot.key;
      this.items.set(slot.key,item);
      const button=this.doc.createElement('button'); button.type='button'; button.setAttribute('role','tab');
      button.onclick=()=>this.select(slot.key); item.append(button);
      }
      item.setAttribute('data-active',String(slot.key === this.model.state.active));
      item.hidden=!!slot.tool;
      const button=item.querySelector<HTMLButtonElement>('[role="tab"]')!;
      button.setAttribute('aria-selected',String(slot.key === this.model.state.active));
      const title=slot.tool?.title || slot.document?.title || '新窗口';
      if(button.textContent!==title)button.textContent=title;
      button.title=title;
      if(slot.document)item.dataset.documentId=slot.document.id;else delete item.dataset.documentId;
      if(this.model.state.slots.length > 1 || slot.tool) {
        let close=item.querySelector<HTMLButtonElement>('.yzc-window-close');
        if(!close){close=this.doc.createElement('button');close.type='button';close.className='yzc-window-close';close.textContent='×';item.append(close);}
        close.setAttribute('aria-label',`关闭窗口 ${title}`);
        close.onclick=() => {
          if(slot.tool)this.closeTool(slot.tool.id);
          else {this.model.close(slot.key);this.activate();}
        };
      } else item.querySelector('.yzc-window-close')?.remove();
      if(this.strip.children[index]!==item)this.strip.insertBefore(item,this.strip.children[index]??null);
    }
    this.mount();
  }
  private select(key: string): void {
    const reselect=this.model.state.active===key;
    this.model.select(key);this.activate();
    const tool=this.model.active.tool;
    if(tool && reselect)this.tools.get(tool.id)?.reselect();
  }
  registerTool(tool:ToolWindow):()=>void {
    if(this.tools.has(tool.id))throw new Error(`窗口工具已注册：${tool.id}`);
    this.tools.set(tool.id,tool);
    this.listeners.forEach(listener=>listener());
    if(this.model.active.tool?.id===tool.id)this.activate();
    else this.mount();
    return()=>{
      if(this.tools.get(tool.id)!==tool)return;
      this.closeTool(tool.id);this.tools.delete(tool.id);this.toolVisibility.delete(tool.id);this.mount();this.listeners.forEach(listener=>listener());
    };
  }
  openTool(id:string):void {
    const tool=this.tools.get(id);
    if(!tool)throw new Error(`窗口工具不可用：${id}`);
    this.model.openTool(id,tool.title);this.activate();
  }
  closeTool(id:string):void {
    const tool=this.tools.get(id),slot=this.model.state.slots.find(s=>s.tool?.id===id);
    const previousBusy=this.busy;this.busy=true;
    try{
      if(slot)this.model.close(slot.key);
      tool?.active(false);this.toolVisibility.set(id,false);
      tool?.close();
    }finally{this.busy=previousBusy;}
    this.activate();
  }
  private foreign():boolean {return this.host.foreign() && ![...this.tools.values()].some(t=>t.isActive());}
  private notifyTools():void {
    for(const [id,tool] of this.tools){
      const active=this.model.active.tool?.id===id;
      if(this.toolVisibility.get(id)!==active){this.toolVisibility.set(id,active);tool.active(active);}
    }
  }
  private onPointerDown = (event:PointerEvent):void => {
    this.suppressClick=false;
    const target=event.target as Element;
    const item=target.closest<HTMLElement>('.yzc-window');
    if(event.button!==0 || !item || target.closest('.yzc-window-close'))return;
    this.pointerDrag={key:item.dataset.windowKey!,pointerId:event.pointerId,x:event.clientX,y:event.clientY,moved:false};
  };
  private onPointerMove = (event:PointerEvent):void => {
    const drag=this.pointerDrag;
    if(!drag || drag.pointerId!==event.pointerId || !(event.buttons&1))return;
    if(!drag.moved && Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>=6){
      drag.moved=true;this.strip.setPointerCapture(event.pointerId);
    }
    if(drag.moved)event.preventDefault();
  };
  private onPointerUp = (event:PointerEvent):void => {
    const drag=this.pointerDrag;this.pointerDrag=undefined;
    if(!drag || !drag.moved)return;
    this.suppressClick=true;
    if(this.strip.hasPointerCapture(event.pointerId))this.strip.releasePointerCapture(event.pointerId);
    const target=this.doc.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('.yzc-window');
    if(target && this.strip.contains(target)){this.model.move(drag.key,target.dataset.windowKey!);this.changed();}
  };
  private activate(): void {
    this.changed();this.notifyTools();
    const slot=this.model.active,tool=slot.tool && this.tools.get(slot.tool.id);
    if(tool){
      const key=slot.key;
      this.queue=this.queue.then(async()=>{
        if(this.disposed || this.model.state.active!==key)return;
        this.busy=true;
        try{await tool.open();if(!this.disposed)this.mount();}finally{this.busy=false;}
      }).catch(this.report);
    }else if(slot.document)this.browse(slot.document);
  }
  browse(target: WindowDocument): void {
    this.closeHistory();
    this.model.visit(target);this.changed();this.notifyTools();
    const slot=this.model.state.active;
    this.queue=this.queue.then(async () => {
      if(this.disposed || this.model.state.active !== slot) return;
      this.busy=true;
      try {
        const previous=this.native;
        const opened=this.host.active()?.id === target.id ? this.host.active()! : await this.host.open(target.id);
        if(this.disposed) return;
        this.native=opened;
        if(previous && previous.token !== opened.token) this.host.close(previous);
        const owner=this.model.state.slots.find(s=>s.key===slot);
        if(owner)owner.document={id:opened.id,title:opened.title};
        this.model.remember(opened);this.changed();
      } finally {this.busy=false;}
    }).catch(error => {if(!this.disposed)this.report(error);});
  }
  private onHostChange = (): void => {
    if(this.disposed || this.busy) return;
    const active=this.host.active();
    if(!this.model.active.document && !this.fromTree && (!this.native || (active?.token === this.native.token && active?.id === this.native.id))) {
      this.native=active ?? this.native;this.mount();return;
    }
    if(active) {
      this.fromTree=false;
      const previous=this.native; this.native=active;
      this.busy=true;
      try {if(previous && previous.token !== active.token)this.host.close(previous);} finally {this.busy=false;}
      this.model.visit(active);this.changed();this.notifyTools();
    } else this.mount();
  };
  private onClick = (event: MouseEvent): void => {
    const target=event.target instanceof this.doc.defaultView!.Element ? event.target as Element : null;
    if(this.history && !target?.closest('.yzc-window-history,.yzc-window-recent')) this.closeHistory();
    const row=target?.closest<HTMLElement>('.file-tree:not(.sy__outline) li[data-type="navigation-file"]');
    if(!row || event.button !== 0 || target?.closest('.b3-list-item__toggle,.b3-list-item__icon,.b3-list-item__action') || !row.dataset.nodeId) return;
    // Keep the host's tree selection, focus and keyboard behavior. Its editor
    // event replaces the active slot and closes the previous native editor.
    this.fromTree=true;
    // Publish the clicked identity in the capture phase, before the host creates
    // its editor/tab. Native selection/navigation still runs without interception.
    this.model.visit({id:row.dataset.nodeId,title:row.querySelector('.b3-list-item__text')?.textContent?.trim() || '未命名文档'});
    this.changed();this.notifyTools();
    const current=this.host.active();
    if(current?.id === row.dataset.nodeId) {this.fromTree=false;this.model.visit(current);this.changed();}
  };
  private onKey = (event: KeyboardEvent): void => {
    if(event.key==='Escape'){
      this.closeHistory();
      const drag=this.pointerDrag;
      if(drag?.moved && this.strip.hasPointerCapture(drag.pointerId))this.strip.releasePointerCapture(drag.pointerId);
      this.pointerDrag=undefined;
    }
  };
  private openHistory(anchor: HTMLElement): void {
    if(this.history) {this.closeHistory();return;}
    const menu=this.doc.createElement('div');menu.className='yzc-window-history';menu.setAttribute('role','menu');
    const label=this.doc.createElement('div');label.className='yzc-window-history-label';label.textContent='最近';menu.append(label);
    for(const item of this.model.state.recent) {
      const button=this.doc.createElement('button');button.type='button';button.setAttribute('role','menuitem');button.textContent=item.title;button.onclick=() => this.browse(item);menu.append(button);
    }
    const rect=anchor.getBoundingClientRect();menu.style.right=`${Math.max(8,this.doc.documentElement.clientWidth-rect.right)}px`;menu.style.top=`${rect.bottom+4}px`;
    this.history=menu;this.doc.body.append(menu);
  }
  private closeHistory(): void {this.history?.remove();this.history=undefined;}
  dispose(): void {
    for(const tool of this.tools.values())tool.active(false);
    this.tools.clear();this.toolVisibility.clear();
    this.listeners.clear();
    this.disposed=true;this.events.abort();this.observer.disconnect();this.unsubscribe();this.closeHistory();this.nav.remove();this.empty.remove();
    for(const row of this.rows)row.removeAttribute('data-yzc-native-tabs');this.rows.clear();this.items.clear();
    this.doc.querySelectorAll('[data-yzc-window-empty]').forEach(el=>el.removeAttribute('data-yzc-window-empty'));
  }
}
