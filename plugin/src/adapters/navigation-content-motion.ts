/** A view change animates the existing sidebar content only. Native tree
 * expansion, editor and reading instances keep their own lifecycle. */
export class NavigationContentMotion {
  private animations=new Map<HTMLElement,Animation>();
  private media?:MediaQueryList;
  private reduce=()=>{if(this.media?.matches)this.cancel();};
  constructor(private doc:Document){this.media=doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');this.media?.addEventListener('change',this.reduce);}
  reveal(node:HTMLElement,direction=1):void{
    if(this.media?.matches||!node.animate||!node.getClientRects().length)return;
    const previous=this.animations.get(node),style=previous?this.doc.defaultView!.getComputedStyle(node):undefined;
    const opacity=style?.opacity??'.6',transform=style?.transform??`translateX(${direction*6}px)`;
    previous?.cancel();
    const animation=node.animate([{opacity,transform},{opacity:1,transform:'translateX(0)'}],{duration:180,easing:'ease-out'});
    this.animations.set(node,animation);
    void animation.finished.then(()=>{if(this.animations.get(node)===animation)this.animations.delete(node);},()=>{});
  }
  private cancel():void{this.animations.forEach(animation=>animation.cancel());this.animations.clear();}
  dispose():void{this.cancel();this.media?.removeEventListener('change',this.reduce);}
}
