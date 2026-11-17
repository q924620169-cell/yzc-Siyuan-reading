export interface ToolWindow {
  id:string;title:string;isActive():boolean;open():Promise<void>;close():void;
  active(value:boolean):void;reselect():void;
}
export interface InlBridge {
  version:1;register(tool:ToolWindow):()=>void;open(id:string):void;close(id:string):void;
  rootInboxTargets():Promise<{id:string;name:string}[]>;
  importTarget?(preferred?:string):Promise<{id:string;name:string}>;
  classifyImported?(id:string):Promise<void>;
}
export class BridgeClient {
  current?:InlBridge;
  private unregister?:()=>void;
  private events=new AbortController();
  constructor(private tool:ToolWindow,private availability:(available:boolean)=>void){
    document.addEventListener('yzc-inl:bridge-ready',e=>this.accept((e as CustomEvent<InlBridge>).detail),{signal:this.events.signal});
    document.addEventListener('yzc-inl:bridge-offline',event=>{
      if(!this.current || (event as CustomEvent<InlBridge>).detail!==this.current)return;
      this.unregister=undefined;this.current=undefined;tool.active(false);tool.close();this.availability(false);
    },{signal:this.events.signal});
  }
  connect():void{
    document.dispatchEvent(new CustomEvent('yzc-inl:bridge-request',{detail:{accept:(b:InlBridge)=>this.accept(b)}}));
    if(!this.current)this.availability(false);
  }
  private accept(bridge:InlBridge):void {
    if(bridge.version!==1 || this.current===bridge)return;
    this.unregister?.();this.current=bridge;this.unregister=bridge.register(this.tool);this.availability(true);
  }
  open():void {
    if(!this.current)return;
    this.current.open(this.tool.id);
  }
  dispose():void{this.events.abort();this.unregister?.();this.current=undefined;}
}
