import type { Plugin } from 'siyuan';
export interface CreatedDocument { id: string; parentId?: string; notebook: string }

/** Path is used only to decode a host creation event's parent ID, never to infer INL metadata. */
export function decodeCreation(detail: { cmd?: string; data?: unknown }): CreatedDocument | undefined {
  if (!['create', 'createdailynote'].includes(detail.cmd ?? '')) return;
  const data = detail.data as { id?: string; rootID?: string; path?: string; box?: string | { id: string }; notebook?: string } | undefined;
  if (!data?.path) return;
  const parts = data.path.replace(/\.sy$/, '').split('/').filter(Boolean);
  const id = data.id || data.rootID || parts.at(-1);
  const notebook = typeof data.box === 'object' ? data.box.id : data.box || data.notebook;
  if (!id || !notebook) return;
  return { id, notebook, parentId: parts.length > 1 ? parts.at(-2) : undefined };
}
export class HostEventsAdapter {
  private ws: (event: CustomEvent) => void;
  private refresh: () => void;
  constructor(private plugin: Plugin, onChange: () => void, onCreate: (doc: CreatedDocument) => void, onStructureChange: () => void = () => {}) {
    this.refresh = onChange;
    this.ws = event => {
      const created = decodeCreation(event.detail);
      if (created) onCreate(created);
      if (['create','createdailynote','removeDoc','moveDocs','mount','closeBox','removeBox','refresh','syncMergeResult','heading2doc','li2doc'].includes(event.detail.cmd)) onStructureChange();
      if (['create', 'createdailynote', 'rename', 'removeDoc', 'moveDocs', 'mount', 'closeBox', 'removeBox', 'setBlockAttrs', 'refresh', 'transactions', 'syncMergeResult'].includes(event.detail.cmd)) onChange();
    };
    plugin.eventBus.on('ws-main', this.ws);
    plugin.eventBus.on('switch-protyle', this.refresh);
    plugin.eventBus.on('loaded-protyle-static', this.refresh);
  }
  dispose(): void {
    this.plugin.eventBus.off('ws-main', this.ws);
    this.plugin.eventBus.off('switch-protyle', this.refresh);
    this.plugin.eventBus.off('loaded-protyle-static', this.refresh);
  }
}
