/** Public, versioned contract. Consumers never touch INL private fields or storage. */
export interface ToolWindow {
  id:string;
  title:string;
  isActive():boolean;
  open():Promise<void>;
  close():void;
  active(value:boolean):void;
  reselect():void;
}
export interface InlBridge {
  version:1;
  register(tool:ToolWindow):()=>void;
  open(id:string):void;
  close(id:string):void;
  openDocument?(id:string,title:string):void;
  rootInboxTargets():Promise<{id:string;name:string}[]>;
  importTarget?(preferred?:string):Promise<{id:string;name:string}>;
  classifyImported?(id:string):Promise<void>;
}
