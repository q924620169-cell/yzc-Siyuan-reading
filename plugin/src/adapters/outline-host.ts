import { getAllEditor, getActiveEditor, openTab, type Plugin } from 'siyuan';
import { kernel } from './document-attribute-adapter';
import type { OutlineHost, OutlineNode } from './outline-adapter';

export function outlineHost(plugin: Plugin): OutlineHost {
  return {
    editors: () => getAllEditor().flatMap(editor => {
      const p = editor.protyle;
      return p.block.rootID && p.contentElement && p.element.isConnected && p.element.getClientRects().length && !p.element.closest('.fn__none')
        ? [{ id: p.block.rootID, element: p.element, content: p.contentElement }] : [];
    }),
    active: () => getActiveEditor()?.protyle.element,
    load: id => kernel<OutlineNode[]>('/api/outline/getDocOutline', { id }),
    jump: id => { void openTab({ app: plugin.app, doc: { id, action: ['cb-get-scroll'] } }); },
    subscribe: refresh => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const update = () => refresh();
      const ws = (event: CustomEvent) => {
        if (['transactions', 'refresh', 'syncMergeResult'].includes(event.detail.cmd)) {
          clearTimeout(timer); timer = setTimeout(() => refresh(true), 180);
        }
      };
      const events = ['switch-protyle', 'loaded-protyle-static', 'loaded-protyle-dynamic', 'destroy-protyle', 'switch-protyle-mode'] as const;
      for (const event of events) plugin.eventBus.on(event, update);
      plugin.eventBus.on('ws-main', ws);
      return () => { clearTimeout(timer); for (const event of events) plugin.eventBus.off(event, update); plugin.eventBus.off('ws-main', ws); };
    },
  };
}
