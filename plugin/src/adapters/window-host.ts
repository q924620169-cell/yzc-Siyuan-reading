import { getActiveTab, getAllEditor, getAllTabs, openTab, type Plugin } from 'siyuan';
import type { WindowDocument } from '../windows/window-model';
export interface HostDocument extends WindowDocument { token: string }
export interface WindowHost {
  active(): HostDocument | undefined;
  documents(): HostDocument[];
  open(id: string): Promise<HostDocument>;
  close(doc: HostDocument): void;
  foreign(): boolean;
  subscribe(update: () => void): () => void;
}
export function windowHost(plugin: Plugin): WindowHost {
  const documents = () => getAllTabs().flatMap(tab => {
    if(tab.parent !== getActiveTab()?.parent) return [];
    const loaded=getAllEditor().find(editor=>editor.protyle.model?.parent===tab)?.protyle.block.rootID;
    const raw=tab.headElement?.getAttribute('data-initdata');
    const pending=raw ? JSON.parse(raw) as {instance?:string;rootId?:string} : undefined;
    const id=loaded || (pending?.instance === 'Editor' ? pending.rootId : undefined);
    return id ? [{id,title:tab.title || tab.headElement?.querySelector('.item__text')?.textContent || '未命名文档',token:tab.id}] : [];
  });
  return {
    documents,
    active: () => documents().find(d => d.token === getActiveTab()?.id),
    foreign: () => {
      const tab=getActiveTab();
      if(!tab?.headElement || getAllTabs('Editor').some(editor=>editor.id===tab.id))return false;
      // Absence of a loaded rootID is not evidence of a tool tab. The host
      // creates an Editor model before its protyle/rootID finishes loading.
      if(tab.model)return true;
      const raw=tab.headElement.getAttribute('data-initdata');
      return !!raw && JSON.parse(raw).instance!=='Editor';
    },
    open: async id => {
      // Explicitly create the replacement before closing the previous editor.
      // This avoids the host's preview-tab setting and cross-tab deduplication.
      const tab=await openTab({app:plugin.app,doc:{id},openNewTab:true,removeCurrentTab:false});
      if (!tab) throw new Error('无法打开此文档');
      const editor=getAllEditor().find(e => e.protyle.model?.parent === tab);
      return {id:editor?.protyle.block.rootID || id,title:tab.title || '未命名文档',token:tab.id};
    },
    close: doc => { const tab=getAllTabs().find(t=>t.id===doc.token); tab?.parent.removeTab(tab.id,false,false); },
    subscribe: update => {
      const events=['switch-protyle','loaded-protyle-static','destroy-protyle'] as const;
      for(const event of events) plugin.eventBus.on(event,update);
      return () => { for(const event of events) plugin.eventBus.off(event,update); };
    },
  };
}
