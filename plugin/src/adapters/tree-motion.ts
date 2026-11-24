import {motion} from '../../../shared/motion.js';
const timing = { ...motion.fold, fill: 'both' as const };
type SavedStyle = { value: string; priority: string };
type Running = { animation: Animation; restore(): void };

/** One motion owner per branch. Native loading/removal callbacks remain native;
 * only their keyframes are corrected after the projection has committed. */
export class TreeMotion {
  private own = new Map<HTMLElement, Running>();
  private native = new Map<Animation, HTMLElement>();
  private ready = new WeakSet<Animation>();
  constructor(private doc: Document) {}
  private reduced(): boolean { return !!this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches; }
  private animations(el: HTMLElement): Animation[] { return el.getAnimations?.() ?? []; }
  private heightFrames(animation: Animation): ComputedKeyframe[] | undefined {
    const frames = (animation.effect as KeyframeEffect | null)?.getKeyframes?.();
    return frames?.some(frame => frame.height !== undefined) ? frames : undefined;
  }
  private finishBelow(el: HTMLElement): void {
    for (const [animation, child] of this.native) if (child !== el && el.contains(child) && animation.playState !== 'finished') this.finishNative(animation);
    for (const child of this.own.keys()) if (child !== el && el.contains(child)) this.stop(child);
  }
  private finishNative(animation: Animation): void {
    this.ready.add(animation);
    const opening=parseFloat(String(this.heightFrames(animation)?.at(-1)?.height))>0;
    animation.finish();
    // finished.then(hostCleanup) runs in a microtask. Remove the obsolete open
    // height immediately so an ancestor cannot measure that stale fill frame.
    if(opening)(animation.effect as KeyframeEffect).setKeyframes([]);
  }
  private ancestorMoving(el: HTMLElement): boolean {
    return [...this.native].some(([animation, parent]) => parent !== el && parent.contains(el) && ['running','paused'].includes(animation.playState));
  }
  /** Called before paint, after all known roles and section states are applied.
   * Unknown scopes pause at zero until their first complete projection arrives. */
  settle(lists: Iterable<{ list?: HTMLElement; settled: boolean }>, focus: boolean): void {
    for (const [animation, el] of this.native) if (!el.isConnected || animation.playState === 'idle' || animation.playState === 'finished') this.native.delete(animation);
    const entries = [...lists];
    for (const {list} of entries) if (list) for (const animation of this.animations(list)) {
      if (this.own.get(list)?.animation !== animation && this.heightFrames(animation)) this.native.set(animation,list);
    }
    for (const {list,settled} of entries) {
      if (!list) continue;
      for (const animation of this.animations(list)) {
        if (!this.native.has(animation) || this.ready.has(animation)) continue;
        const frames = this.heightFrames(animation)!;
        const opening = parseFloat(String(frames.at(-1)?.height)) > 0;
        if (focus || this.reduced() || this.ancestorMoving(list)) { this.ready.add(animation); this.finishNative(animation); continue; }
        if (opening && !settled) { animation.pause(); animation.currentTime = 0; continue; }
        this.finishBelow(list);
        const effect = animation.effect as KeyframeEffect;
        // Remove the host's old raw-tree height while measuring the final DOM.
        effect.setKeyframes([]);
        const height = list.getBoundingClientRect().height;
        effect.setKeyframes([{height: opening ? '0px' : `${height}px`,opacity:opening?0:1,transform:opening?'translateY(-2px)':'none'},
          {height: opening ? `${height}px` : '0px',opacity:opening?1:0,transform:opening?'none':'translateY(-2px)'}]);
        effect.updateTiming({...timing,duration:this.reduced()?0:timing.duration});
        animation.currentTime = 0; this.ready.add(animation); animation.play();
      }
    }
  }
  private stop(el: HTMLElement): void {
    const run = this.own.get(el);
    if (!run) return;
    this.own.delete(el); run.animation.cancel(); run.restore();
  }
  private run(el: HTMLElement, frames: Keyframe[], styles: Record<string,string> = {}): void {
    this.stop(el);
    if (!el.animate || this.reduced()) return;
    const saved = new Map<string,SavedStyle>();
    for (const [key,value] of Object.entries(styles)) { saved.set(key,{value:el.style.getPropertyValue(key),priority:el.style.getPropertyPriority(key)}); el.style.setProperty(key,value,'important'); }
    const media = this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
    const reduce = () => { if (media?.matches) this.stop(el); };
    const restore = () => {
      media?.removeEventListener('change', reduce);
      for (const [key,value] of saved) { if(value.value)el.style.setProperty(key,value.value,value.priority);else el.style.removeProperty(key); }
    };
    const animation = el.animate(frames,timing);
    const run = {animation,restore}; this.own.set(el,run);
    media?.addEventListener('change', reduce);
    const done = () => { if(this.own.get(el)===run){this.own.delete(el);animation.cancel();restore();} };
    void animation.finished.then(done,done);
  }
  /** Animate native sibling entries; no wrappers, cached heights or clones. */
  change(entries: HTMLElement[], commit: () => void): void {
    const before = entries.map(el => ({el,height:el.getBoundingClientRect().height,display:this.doc.defaultView!.getComputedStyle(el).display}));
    entries.forEach(el=>{this.finishBelow(el);this.stop(el);});
    commit();
    for(const [animation,parent] of this.native) {
      if(!['running','paused'].includes(animation.playState)||!entries.some(el=>parent.contains(el)))continue;
      const effect=animation.effect as KeyframeEffect;
      const frames=this.heightFrames(animation);
      if(!frames||parseFloat(String(frames.at(-1)?.height))===0)continue;
      const current=parent.getBoundingClientRect().height;
      effect.setKeyframes([]);
      const end=parent.getBoundingClientRect().height;
      effect.setKeyframes([{height:`${current}px`},{height:`${end}px`}]);animation.currentTime=0;
    }
    for (const {el,height,display} of before) {
      if (!el.isConnected || this.ancestorMoving(el)) continue;
      const style = this.doc.defaultView!.getComputedStyle(el);
      const end = el.getBoundingClientRect().height;
      if (height===end || (display==='none' && style.display==='none')) continue;
      const show = style.display!=='none';
      const full = {paddingTop:style.paddingTop,paddingBottom:style.paddingBottom,marginTop:style.marginTop,marginBottom:style.marginBottom};
      const flat = {paddingTop:'0px',paddingBottom:'0px',marginTop:'0px',marginBottom:'0px'};
      this.run(el,[{height:`${height}px`,opacity:show?0:1,transform:show?'translateY(-2px)':'none',...(show?flat:full)},
        {height:`${end}px`,opacity:show?1:0,transform:show?'none':'translateY(-2px)',...(show?full:flat)}],
        {display:show?style.display:display,overflow:'clip','min-height':'0','box-sizing':'border-box'});
    }
  }
  fade(el: HTMLElement): void {
    this.finishBelow(el);
    this.run(el,[{opacity:.25,transform:'translateY(2px)'},{opacity:1,transform:'none'}]);
  }
  /** Context fade for Focus navigation. Branch folds use FlatTreeMotion. */
  reveal(container: HTMLElement): void {
    const opacity = this.own.has(container)
      ? this.doc.defaultView!.getComputedStyle(container).opacity : '.85';
    this.run(container, [{opacity}, {opacity:1}]);
  }
  dispose(): void {
    for (const el of this.own.keys()) this.stop(el);
    // Release host callbacks before returning native ownership on theme exit.
    for (const animation of this.native.keys()) if (['running','paused'].includes(animation.playState)) this.finishNative(animation);
    this.native.clear();
  }
}
