import {motion} from '../../../shared/motion.js';
/** FLIP keeps the existing controls under the pointer while their order changes.
 * Interrupted moves start at their current on-screen position, not the last slot. */
export class NavigationMotion {
  private animations=new Map<HTMLElement,Animation>();
  private media?:MediaQueryList;
  private reduce=()=>{if(this.media?.matches)this.cancel();};
  constructor(private doc:Document){this.media=doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');this.media?.addEventListener('change',this.reduce);}
  reconcile(parent:HTMLElement,nodes:HTMLElement[],offset=0):void{
    if(nodes.every((node,index)=>parent.children[index+offset]===node))return;
    const before=new Map(nodes.map(node=>[node,node.getBoundingClientRect()]));
    nodes.forEach(node=>{this.animations.get(node)?.cancel();this.animations.delete(node);});
    nodes.forEach((node,index)=>{if(parent.children[index+offset]!==node)parent.insertBefore(node,parent.children[index+offset]??null);});
    if(this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    for(const node of nodes){if(node.dataset.dragging==='true')continue;const from=before.get(node)!,to=node.getBoundingClientRect(),x=from.left-to.left,y=from.top-to.top;if((Math.abs(x)<.5&&Math.abs(y)<.5)||!node.animate)continue;
      const animation=node.animate([{transform:`translate(${x}px,${y}px)`},{transform:'translate(0,0)'}],motion.settle);this.animations.set(node,animation);
      const done=()=>{if(this.animations.get(node)===animation)this.animations.delete(node);};void animation.finished.then(done,done);
    }
  }
  private cancel():void{this.animations.forEach(animation=>animation.cancel());this.animations.clear();}
  dispose():void{this.cancel();this.media?.removeEventListener('change',this.reduce);}
}
