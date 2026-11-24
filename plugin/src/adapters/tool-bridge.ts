import type {WindowAdapter} from './window-adapter';
import type {InlBridge} from '../windows/tool-contract';
import {InboxNotebook} from './inbox-notebook';

export class ToolBridge {
  readonly api:InlBridge;
  constructor(windows:WindowAdapter,inbox:InboxNotebook,private doc:Document=document){
    this.api={version:1,register:tool=>windows.registerTool(tool),open:id=>windows.openTool(id),close:id=>windows.closeTool(id),
      openDocument:(id,title)=>windows.browse({id,title}),
      importTarget:pendingNotebook=>inbox.importTarget(pendingNotebook),
      rootInboxTargets:async()=>{
        const notebook=await inbox.find();
        return notebook&&!notebook.closed?[notebook]:[];
      },
    };
    doc.addEventListener('yzc-inl:bridge-request',this.request);
    doc.dispatchEvent(new doc.defaultView!.CustomEvent('yzc-inl:bridge-ready',{detail:this.api}));
  }
  private request=(event:Event):void=>{(event as CustomEvent<{accept?:(bridge:InlBridge)=>void}>).detail?.accept?.(this.api);};
  dispose():void{
    this.doc.removeEventListener('yzc-inl:bridge-request',this.request);
    this.doc.dispatchEvent(new this.doc.defaultView!.CustomEvent('yzc-inl:bridge-offline',{detail:this.api}));
  }
}
