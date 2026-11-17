export const ORDER_KEY='navigation-order.json';
const defaults={spaces:['document','yzc-Reader','yzc-RSS'],shortcuts:['home','library','inbox']};
export type OrderGroup=keyof typeof defaults;
export interface NavigationOrder {version:1;spaces:string[];shortcuts:string[]}
export function normalizeOrder(raw:unknown):NavigationOrder {
  const value=(raw&&typeof raw==='object'?raw:{}) as Partial<NavigationOrder>;
  const group=(key:OrderGroup)=>[...new Set([...(Array.isArray(value[key])?value[key]:[]),...defaults[key]])].filter(id=>defaults[key].includes(id));
  return {version:1,spaces:group('spaces'),shortcuts:group('shortcuts')};
}
/** Both navigation levels share a serialized, independent preference file. */
export class NavigationPreferences {
  private state:NavigationOrder;
  private listeners=new Set<()=>void>();
  private queue:Promise<unknown>=Promise.resolve();
  private pending=0;
  private preview?:{group:OrderGroup;order:string[]};
  constructor(raw:unknown,private save:(state:NavigationOrder)=>Promise<unknown>,private report:(error:unknown)=>void){this.state=normalizeOrder(raw);}
  order(group:OrderGroup):readonly string[]{return this.preview?.group===group?this.preview.order:this.state[group];}
  subscribe(listener:()=>void):()=>void{this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  replace(raw:unknown):void{if(this.pending||this.preview)return;const next=normalizeOrder(raw);if(JSON.stringify(next)!==JSON.stringify(this.state)){this.state=next;this.emit();}}
  beginPreview(group:OrderGroup):boolean{if(this.preview)return false;this.preview={group,order:[...this.state[group]]};return true;}
  previewMove(group:OrderGroup,id:string,before:string|null):void{
    if(this.preview?.group!==group)return;const order=[...this.preview.order];if(!order.includes(id)||id===before||before!==null&&!order.includes(before))return;
    order.splice(order.indexOf(id),1);order.splice(before===null?order.length:order.indexOf(before),0,id);
    if(JSON.stringify(order)===JSON.stringify(this.preview.order))return;this.preview.order=order;this.emit();
  }
  finishPreview(group:OrderGroup,commit:boolean):void{if(this.preview?.group!==group)return;const order=this.preview.order;this.preview=undefined;if(commit)this.update(group,order);else this.emit();}
  move(group:OrderGroup,id:string,before:string|null):void{
    const order=[...this.state[group]];if(!order.includes(id)||id===before||before!==null&&!order.includes(before))return;
    order.splice(order.indexOf(id),1);order.splice(before===null?order.length:order.indexOf(before),0,id);this.update(group,order);
  }
  step(group:OrderGroup,id:string,offset:number):void{
    const order=[...this.state[group]],from=order.indexOf(id),to=from+offset;if(from<0||to<0||to>=order.length)return;
    order.splice(from,1);order.splice(to,0,id);this.update(group,order);
  }
  reset(group:OrderGroup):void{this.update(group,[...defaults[group]]);}
  private update(group:OrderGroup,order:string[]):void{
    if(JSON.stringify(order)===JSON.stringify(this.state[group]))return;
    this.state={...this.state,[group]:order};const snapshot=normalizeOrder(this.state);this.emit();this.pending++;
    this.queue=this.queue.then(()=>this.save(snapshot)).catch(this.report).finally(()=>{this.pending--;});
  }
  private emit():void{this.listeners.forEach(listener=>listener());}
  dispose():void{this.listeners.clear();}
}
