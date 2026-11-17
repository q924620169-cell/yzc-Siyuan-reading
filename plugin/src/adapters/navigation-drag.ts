import type{NavigationPreferences,OrderGroup}from'../navigation-order';

interface Gesture {button:HTMLButtonElement;id:string;pointer:number;downX:number;downY:number;x:number;y:number;offsetX:number;offsetY:number;width:number;height:number;moved:boolean;originalTransform:string;abort:AbortController}
const controllers=new WeakMap<HTMLElement,NavigationDrag>();

/** The same button follows the pointer. Its layout slot previews the drop;
 * siblings use the existing FLIP motion. Only pointer release saves the order. */
class NavigationDrag {
  private buttons=new Map<string,HTMLButtonElement>();
  private gesture?:Gesture;
  private frame=0;
  private suppressClick=false;
  private abort:AbortController;
  private landings=new Map<HTMLElement,Animation>();
  constructor(private parent:HTMLElement,private group:OrderGroup,private prefs:NavigationPreferences){
    const view=parent.ownerDocument.defaultView!;this.abort=new view.AbortController();
    parent.addEventListener('pointerdown',this.down,{signal:this.abort.signal});
    parent.addEventListener('click',event=>{if(this.suppressClick&&event.detail!==0){this.suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}},{capture:true,signal:this.abort.signal});
  }
  add(id:string,button:HTMLButtonElement):()=>void{this.buttons.set(id,button);return()=>{if(this.gesture?.button===button)this.finish(false,false);this.buttons.delete(id);if(!this.buttons.size)this.dispose();};}
  private down=(event:PointerEvent):void=>{
    if(this.gesture||event.button!==0||!event.isPrimary)return;
    this.suppressClick=false;
    const button=(event.target as Element).closest<HTMLButtonElement>('[data-order-id]');
    if(!button||button.parentElement!==this.parent||button.disabled)return;
    const rect=button.getBoundingClientRect(),view=this.parent.ownerDocument.defaultView!,abort=new view.AbortController();
    this.gesture={button,id:button.dataset.orderId!,pointer:event.pointerId,downX:event.clientX,downY:event.clientY,x:event.clientX,y:event.clientY,offsetX:event.clientX-rect.left,offsetY:event.clientY-rect.top,width:rect.width,height:rect.height,moved:false,originalTransform:button.style.transform,abort};
    const doc=this.parent.ownerDocument;
    doc.addEventListener('pointermove',this.move,{capture:true,passive:false,signal:abort.signal});
    doc.addEventListener('pointerup',this.up,{capture:true,signal:abort.signal});
    doc.addEventListener('pointercancel',()=>this.finish(false),{capture:true,signal:abort.signal});
    view.addEventListener('keydown',this.key,{capture:true,signal:abort.signal});
    view.addEventListener('blur',()=>this.finish(false),{signal:abort.signal});
  };
  private move=(event:PointerEvent):void=>{
    const drag=this.gesture;if(!drag||event.pointerId!==drag.pointer)return;
    drag.x=event.clientX;drag.y=event.clientY;
    if(!drag.moved){
      if(Math.hypot(drag.x-drag.downX,drag.y-drag.downY)<6)return;
      if(!this.prefs.beginPreview(this.group)){this.finish(false);return;}
      drag.moved=true;this.landings.get(drag.button)?.cancel();this.landings.delete(drag.button);
      delete drag.button.dataset.settling;
      for(const animation of drag.button.getAnimations?.()??[])if((animation.effect as KeyframeEffect)?.getKeyframes().some(frame=>frame.transform!==undefined))animation.cancel();
      drag.button.dataset.dragging='true';drag.button.setAttribute('aria-grabbed','true');this.parent.dataset.reordering='true';this.parent.ownerDocument.documentElement.setAttribute('data-yzc-nav-dragging','');
      try{this.parent.setPointerCapture(drag.pointer);}catch{/* Document listeners also cover a host without pointer capture. */}
    }
    event.preventDefault();if(!this.frame)this.frame=this.parent.ownerDocument.defaultView!.requestAnimationFrame(()=>{this.frame=0;this.paint();});
  };
  private slot(button:HTMLButtonElement):{left:number;top:number;width:number;height:number}{const rect=this.parent.getBoundingClientRect();return{left:rect.left+this.parent.clientLeft+button.offsetLeft-this.parent.scrollLeft,top:rect.top+this.parent.clientTop+button.offsetTop-this.parent.scrollTop,width:button.offsetWidth,height:button.offsetHeight};}
  private paint():void{
    const drag=this.gesture;if(!drag?.moved)return;
    const horizontal=this.group==='spaces',axis=horizontal?drag.x-drag.offsetX+drag.width/2:drag.y-drag.offsetY+drag.height/2;
    for(let pass=0;pass<this.buttons.size;pass++){
      const order=this.prefs.order(this.group),index=order.indexOf(drag.id),slot=this.slot(drag.button),center=horizontal?slot.left+slot.width/2:slot.top+slot.height/2;
      const before=index>0?this.buttons.get(order[index-1]):undefined,after=index<order.length-1?this.buttons.get(order[index+1]):undefined;
      const middle=(button:HTMLButtonElement)=>{const r=this.slot(button);return(center+(horizontal?r.left+r.width/2:r.top+r.height/2))/2;};
      if(before&&axis<middle(before))this.prefs.previewMove(this.group,drag.id,order[index-1]);
      else if(after&&axis>middle(after))this.prefs.previewMove(this.group,drag.id,order[index+2]??null);
      else break;
    }
    const slot=this.slot(drag.button),x=drag.x-drag.offsetX-slot.left,y=drag.y-drag.offsetY-slot.top;
    drag.button.style.transform=`translate3d(${x}px,${y}px,0) scale(1.025)`;
    this.parent.style.setProperty('--yzc-drop-x',drag.button.offsetLeft+'px');this.parent.style.setProperty('--yzc-drop-y',drag.button.offsetTop+'px');
    this.parent.style.setProperty('--yzc-drop-width',slot.width+'px');this.parent.style.setProperty('--yzc-drop-height',slot.height+'px');
    // Reparenting a captured child would lose capture; the stable parent owns it.
  }
  private up=(event:PointerEvent):void=>{const drag=this.gesture;if(!drag||event.pointerId!==drag.pointer)return;if(drag.moved){drag.x=event.clientX;drag.y=event.clientY;this.paint();event.preventDefault();}const rect=this.parent.getBoundingClientRect();this.finish(event.clientX>=rect.left-8&&event.clientX<=rect.right+8&&event.clientY>=rect.top-12&&event.clientY<=rect.bottom+12);};
  private key=(event:KeyboardEvent):void=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();this.finish(false);}else if(this.gesture?.moved&&event.key.startsWith('Arrow')){event.preventDefault();event.stopImmediatePropagation();}};
  private finish(commit:boolean,animate=true):void{
    const drag=this.gesture;if(!drag)return;
    if(this.frame)this.parent.ownerDocument.defaultView!.cancelAnimationFrame(this.frame);this.frame=0;
    const from=drag.button.getBoundingClientRect();this.gesture=undefined;drag.abort.abort();
    if(drag.moved){
      this.suppressClick=true;this.prefs.finishPreview(this.group,commit);
      drag.button.style.transform=drag.originalTransform;delete drag.button.dataset.dragging;drag.button.removeAttribute('aria-grabbed');delete this.parent.dataset.reordering;
      for(const name of ['x','y','width','height'])this.parent.style.removeProperty('--yzc-drop-'+name);
      this.parent.ownerDocument.documentElement.removeAttribute('data-yzc-nav-dragging');
      const to=drag.button.getBoundingClientRect(),view=this.parent.ownerDocument.defaultView!;
      if(animate&&drag.button.animate&&!view.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
        drag.button.dataset.settling='true';const x=from.left-to.left+(from.width-to.width)/2,y=from.top-to.top+(from.height-to.height)/2;
        const animation=drag.button.animate([{transform:`translate(${x}px,${y}px) scale(${to.width?from.width/to.width:1},${to.height?from.height/to.height:1})`},{transform:drag.originalTransform||'none'}],{duration:210,easing:'cubic-bezier(.22,1,.36,1)'});this.landings.set(drag.button,animation);
        const done=()=>{if(this.landings.get(drag.button)===animation){this.landings.delete(drag.button);delete drag.button.dataset.settling;}};void animation.finished.then(done,done);
      }
    }
    try{if(this.parent.hasPointerCapture?.(drag.pointer))this.parent.releasePointerCapture(drag.pointer);}catch{/* The host may have rebuilt the dock during the gesture. */}
  }
  private dispose():void{this.finish(false,false);this.abort.abort();this.landings.forEach((animation,node)=>{animation.cancel();delete node.dataset.settling;});this.landings.clear();controllers.delete(this.parent);}
}
export function draggableNavigation(button:HTMLButtonElement,id:string,group:OrderGroup,prefs:NavigationPreferences):()=>void{
  const parent=button.parentElement!;let controller=controllers.get(parent);if(!controller){controller=new NavigationDrag(parent,group,prefs);controllers.set(parent,controller);}return controller.add(id,button);
}
