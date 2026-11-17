import type { WindowAdapter } from './window-adapter';
import { toggleLeftDock } from 'siyuan';
import type {NavigationPreferences} from '../navigation-order';
import {reorderable} from './navigation-reorder';
import {NavigationMotion} from './navigation-motion';
import {NavigationContentMotion} from './navigation-content-motion';

/** One owner, one persistent switch. Native Dock models retain their lifecycle. */
export class SpaceNavigation {
  private nav: HTMLElement;
  private observer: MutationObserver;
  private off: () => void;
  private buttons = new Map<string, HTMLButtonElement>();
  private offOrder?:()=>void;
  private motion:NavigationMotion;
  private contentMotion:NavigationContentMotion;
  private active?:string;
  private pending?:{id:string;direction:number;attempts:number};
  private revealFrame=0;
  private reorderOffs:(()=>void)[]=[];
  constructor(private windows: WindowAdapter, private doc: Document = document,private preferences?:NavigationPreferences) {
    this.motion=new NavigationMotion(doc);
    this.contentMotion=new NavigationContentMotion(doc);
    this.nav=doc.createElement('nav');this.nav.className='yzc-space-switch';this.nav.setAttribute('aria-label','空间');
    for(const [id,title,icon] of [['document','文档','document'],['yzc-Reader','书房','reader'],['yzc-RSS','RSS','rss']]) {
      const button=doc.createElement('button');button.type='button';button.title=title;button.setAttribute('aria-label',title);
      button.dataset.space=id;
      const image=doc.createElement('span');image.className='yzc-space-icon';image.style.setProperty('--yzc-icon',`url('/plugins/yzc-Siyuan-reading/assets/space-${icon}.svg')`);image.setAttribute('aria-hidden','true');
      if(id==='document'){image.classList.add('yzc-native-space-icon');image.innerHTML='<svg aria-hidden="true"><use href="#iconFiles"></use></svg>';}
      const label=doc.createElement('span');label.className='yzc-space-label';
      const clip=doc.createElement('span');clip.className='yzc-space-label-clip';
      const text=doc.createElement('span');text.className='yzc-space-label-text';text.textContent=title;clip.append(text);label.append(clip);
      button.append(image,label);button.onclick=()=>{
        if(id==='document'){windows.selectDocuments();doc.dispatchEvent(new doc.defaultView!.CustomEvent('yzc-inl:document-space'));}
        else windows.openTool(id);
      };
      this.buttons.set(id,button);this.nav.append(button);
      if(preferences)this.reorderOffs.push(reorderable(button,id,'spaces',preferences));
    }
    this.offOrder=preferences?.subscribe(()=>this.render());
    this.off=windows.subscribe(()=>this.render());
    this.observer=new doc.defaultView!.MutationObserver(()=>this.mount());
    this.observer.observe(doc.body,{subtree:true,childList:true});
    doc.documentElement.setAttribute('data-yzc-spaces','');this.render();
    // The activity rail is replaced by this switch, so a restored collapsed
    // sidebar needs one native activation to keep the spaces reachable.
    const dock=doc.querySelector<HTMLElement>('.layout__dockl');
    if(dock && (dock.classList.contains('fn__none')||dock.getBoundingClientRect().width<1)) {
      // Some hosts persist a selected model with width=0. Select the document
      // model explicitly before expanding; toggling a restored tool can close it.
      const host=(doc.defaultView as unknown as {siyuan?:{layout?:{leftDock?:{toggleModel(type:string,show:boolean):void;togglePanel?(show:boolean):void}}}})?.siyuan?.layout?.leftDock;
      if(host){host.toggleModel('file',true);host.togglePanel?.(true);}
      else doc.querySelector<HTMLElement>('#dockLeft [data-type="file"]')?.click();
      toggleLeftDock?.(true);
    }
  }
  private mount(): void {
    const dock=this.doc.querySelector('.layout__dockl');
    if(dock && this.nav.parentElement!==dock)dock.prepend(this.nav);
    this.scheduleReveal();
  }
  private scheduleReveal():void{
    if(!this.pending||this.revealFrame)return;
    this.revealFrame=this.doc.defaultView!.requestAnimationFrame(()=>{
      this.revealFrame=0;const pending=this.pending;if(!pending)return;
      const selector=pending.id==='document'?'.sy__file':pending.id==='yzc-Reader'?'.yr-sidebar':'.rss-nav-content';
      const node=[...this.doc.querySelectorAll<HTMLElement>(`.layout__dockl ${selector}`)].find(node=>node.getClientRects().length>0);
      if(node){this.contentMotion.reveal(node,pending.direction);this.pending=undefined;}
      else if(++pending.attempts<16)this.scheduleReveal();
    });
  }
  private render(): void {
    const selected=this.windows.activeSpace;
    const order=this.preferences?.order('spaces')??[...this.buttons.keys()];
    if(this.active!==undefined&&this.active!==selected)this.pending={id:selected,direction:order.indexOf(selected)>=order.indexOf(this.active)?1:-1,attempts:0};
    this.active=selected;
    this.motion.reconcile(this.nav,order.map(id=>this.buttons.get(id)!));
    for(const [id,button] of this.buttons) {
      const active=id===selected;
      if(button.getAttribute('aria-pressed')!==String(active))button.setAttribute('aria-pressed',String(active));
      button.disabled=id!=='document'&&!this.windows.hasTool(id);
    }
    if(this.doc.documentElement.dataset.yzcSpace!==selected)this.doc.documentElement.dataset.yzcSpace=selected;
    this.mount();
  }
  dispose():void {
    this.off();this.offOrder?.();this.reorderOffs.forEach(off=>off());this.reorderOffs=[];this.motion.dispose();this.contentMotion.dispose();this.doc.defaultView!.cancelAnimationFrame(this.revealFrame);this.pending=undefined;this.observer.disconnect();this.nav.remove();
    this.doc.documentElement.removeAttribute('data-yzc-spaces');delete this.doc.documentElement.dataset.yzcSpace;
  }
}
