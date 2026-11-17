import type {Plugin} from 'siyuan';
import {kernel,attributes} from './document-attribute-adapter';
import {NotebookMetadataAdapter} from './notebook-metadata-adapter';
import {InlStorage} from '../inl/inl-storage';
import type {WindowAdapter} from './window-adapter';
import type {InlBridge} from '../windows/tool-contract';
import {DocumentImport} from './document-import';

export class ToolBridge {
  readonly api:InlBridge;
  constructor(plugin:Plugin,windows:WindowAdapter,_enabled:()=>boolean,private doc:Document=document,refresh?:(id:string)=>Promise<void>){
    const storage=new InlStorage(attributes(),new NotebookMetadataAdapter(plugin));
    const documents=new DocumentImport(plugin,refresh);
    this.api={version:1,register:tool=>windows.registerTool(tool),open:id=>windows.openTool(id),close:id=>windows.closeTool(id),
      importTarget:preferred=>documents.target(preferred),classifyImported:id=>documents.classify(id),
      rootInboxTargets:async()=>{
        const {notebooks}=await kernel<{notebooks:{id:string;name:string;closed:boolean}[]}>('/api/notebook/lsNotebooks',{});
        const ids=await plugin.loadData('rss-inbox-targets.json');
        const inherited:string[]=[];
        if(!Array.isArray(ids))for(const n of notebooks)if((await storage.read(`notebook:${n.id}`,'root')).role==='inbox')inherited.push(n.id);
        return notebooks.filter(n=>!n.closed&&(Array.isArray(ids)?ids:inherited).includes(n.id)).map(n=>({id:n.id,name:n.name}));
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
