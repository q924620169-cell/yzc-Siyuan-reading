interface NativeEffect {effect:KeyframeEffect;frames:ComputedKeyframe[];height:number;opening:boolean}
interface Branch {height:string;tops:Map<HTMLElement,string>}
/** Keep SiYuan's rows, wrapper, animation and completion callback. Filtering
 * changes occupied height; native index-based close snapshots need that same
 * compact geometry. No replacement tree, click handler or animation is created. */
export class FilteredNativeTree {
  private effects=new Map<Animation,NativeEffect>();
  private branches=new Map<HTMLElement,Branch>();
  constructor(private doc:Document){}
  sync():void{
    for(const [animation]of this.effects)if(!['running','pending','paused'].includes(animation.playState))this.effects.delete(animation);
    for(const [branch]of this.branches)if(!branch.isConnected)this.branches.delete(branch);
    for(const branch of this.doc.querySelectorAll<HTMLElement>('.sy__file [data-tree-animation]')){
      let saved=this.branches.get(branch);if(!saved){saved={height:branch.style.height,tops:new Map()};this.branches.set(branch,saved);}
      let height=0;
      for(const row of [...branch.children] as HTMLElement[]){
        const style=this.doc.defaultView!.getComputedStyle(row);
        if(style.display==='none')continue;
        if(row.style.position==='absolute'){
          if(!saved.tops.has(row))saved.tops.set(row,row.style.top);
          const top=height+'px';if(row.style.top!==top)row.style.top=top;
        }
        height+=row.getBoundingClientRect().height+(parseFloat(style.marginTop)||0)+(parseFloat(style.marginBottom)||0);
      }
      for(const animation of branch.getAnimations?.()??[]){
        const effect=animation.effect as KeyframeEffect|null;if(!effect?.getKeyframes)continue;
        const frames=effect.getKeyframes();if(!frames.some(frame=>frame.height!==undefined))continue;
        if(!Number.isFinite(parseFloat(String(frames[0]?.height)))||!Number.isFinite(parseFloat(String(frames.at(-1)?.height))))continue;
        let record=this.effects.get(animation);
        if(!record){record={effect,frames,height:-1,opening:parseFloat(String(frames.at(-1)?.height))>0};this.effects.set(animation,record);}
        if(Math.abs(record.height-height)<.1)continue;
        record.height=height;
        effect.setKeyframes(record.frames.map((frame,index)=>({...frame,height:(record!.opening?(index===0?0:height):(index===0?height:0))+'px'})));
        // The host's opening inline end-height also contains hidden row slots.
        // Match its corrected effect to prevent a one-frame jump at completion.
        const end=record.opening?height+'px':'0px';if(branch.style.height!==end)branch.style.height=end;
      }
    }
  }
  dispose():void{
    for(const [animation,record]of this.effects)if(animation.playState==='running'||animation.playState==='paused')record.effect.setKeyframes(record.frames);
    for(const [branch,saved]of this.branches)if(branch.isConnected){branch.style.height=saved.height;for(const [row,top]of saved.tops)if(row.parentElement===branch)row.style.top=top;}
    this.effects.clear();this.branches.clear();
  }
}
