import type{InlStatus}from'../inl/inl-status';

/** View-local fold policy on the original SiYuan tree. Native toggles still
 * own loading and animation; Now's visible expansion state is kept separately. */
export class NativeTreeExpansion {
  private now=new Map<string,boolean>();
  private target?:'now'|'collapsed';
  private status:InlStatus='now';
  private requested=new WeakMap<HTMLElement,boolean>();
  private timer?:ReturnType<typeof setTimeout>;
  private captureTimer?:ReturnType<typeof setTimeout>;
  private deadline=0;
  private quiet=0;
  private disposed=false;
  private events:AbortController;
  constructor(private doc:Document,private changed:(state:Record<string,boolean>)=>void){
    this.events=new doc.defaultView!.AbortController();
    doc.addEventListener('pointerdown',event=>{if((event.target as Element).closest('.sy__file li[data-tree-key]'))this.stop();},{capture:true,signal:this.events.signal});
  }
  load(raw:unknown):void{this.now.clear();if(!raw||typeof raw!=='object')return;for(const[key,value]of Object.entries(raw))if(key.startsWith('notebook:')&&typeof value==='boolean')this.now.set(key,value);}
  private rows():HTMLElement[]{return[...this.doc.querySelectorAll<HTMLElement>('.sy__file li[data-tree-key][aria-expanded]')].filter(row=>!row.closest('[data-tree-animation][aria-hidden="true"]'));}
  captureNow():void{
    if(this.target==='now'||this.disposed)return;
    let changed=false;for(const row of this.rows()){const key=row.dataset.treeKey!,open=row.getAttribute('aria-expanded')==='true';if(this.now.get(key)!==open){this.now.set(key,open);changed=true;}}
    if(changed)this.changed(Object.fromEntries(this.now));
  }
  enter(status:InlStatus):void{
    this.stop();this.status=status;this.target=status==='now'?(this.now.size?'now':undefined):'collapsed';
    this.deadline=Date.now()+5000;this.requested=new WeakMap();this.sync(status);
  }
  prepare(status:InlStatus):void{this.stop();this.status=status;}
  private required(key:string):boolean{let end=key.lastIndexOf('/');while(end>=0){key=key.slice(0,end);if(this.now.get(key)===false)return false;end=key.lastIndexOf('/');}return true;}
  sync(status:InlStatus):void{
    if(this.disposed)return;this.status=status;
    if(this.target){
      const target=this.target,rows=this.rows(),seen=new Set(rows.map(row=>row.dataset.treeKey!));let pending=false;
      const ordered=target==='collapsed'?[...rows].sort((a,b)=>b.dataset.treeKey!.split('/').length-a.dataset.treeKey!.split('/').length):rows;
      for(const row of ordered){
        if(!row.isConnected||row.closest('[data-tree-animation][aria-hidden="true"]'))continue;
        const desired=target==='collapsed'?false:this.now.get(row.dataset.treeKey!);if(desired===undefined)continue;
        const open=row.getAttribute('aria-expanded')==='true';
        if(open===desired){this.requested.delete(row);continue;}
        pending=true;if(row.getAttribute('aria-busy')==='true'||this.requested.get(row)===desired)continue;
        const toggle=row.querySelector<HTMLElement>(':scope>.b3-list-item__toggle');if(toggle){this.requested.set(row,desired);toggle.click();}
      }
      if(target==='now')for(const[key,open]of this.now)if(open&&this.required(key)&&!seen.has(key))pending=true;
      if(this.doc.querySelector('.sy__file [data-tree-animation],.sy__file [aria-busy="true"],.sy__file [data-tree-loading]'))pending=true;
      if(pending)this.quiet=0;else if(!this.quiet)this.quiet=Date.now();
      if(!pending&&Date.now()-this.quiet>=180||Date.now()>=this.deadline){this.target=undefined;clearTimeout(this.timer);}
      else{clearTimeout(this.timer);this.timer=setTimeout(()=>this.sync(this.status),80);}
    }
    if(status==='now'&&!this.target){clearTimeout(this.captureTimer);this.captureTimer=setTimeout(()=>{if(this.status==='now'&&!this.target&&!this.disposed)this.captureNow();},220);}
  }
  private stop():void{this.target=undefined;this.quiet=0;clearTimeout(this.timer);clearTimeout(this.captureTimer);this.requested=new WeakMap();}
  dispose():void{this.disposed=true;this.stop();this.events.abort();}
}
