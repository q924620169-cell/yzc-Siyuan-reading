import type { Plugin } from 'siyuan';
import { kernel } from './document-attribute-adapter';

interface Notebook {
  id: string;
  name: string;
  closed: boolean;
}

const KEY = 'inbox-notebook.json';
const NAME = '未分类';

export async function listNotebooks(): Promise<Notebook[]> {
  const data = await kernel<{ notebooks: Notebook[] } | null>('/api/notebook/lsNotebooks', {});
  if (!data) throw new Error('暂时无法读取思源笔记本列表，请稍后重试。');
  return data.notebooks ?? [];
}

/** The document shortcut and RSS share one native notebook per workspace. */
export class InboxNotebook {
  private pending?: Promise<Notebook>;

  constructor(private plugin: Plugin) {}

  async find(notebooks?: Notebook[]): Promise<Notebook | undefined> {
    const list = notebooks ?? await listNotebooks();
    const binding = await this.plugin.loadData(KEY);
    return list.find(n => n.id === binding?.id) ?? list.find(n => n.name === NAME);
  }

  ensure(): Promise<Notebook> {
    if (!this.pending) {
      const resolve = async () => {
        const locks = globalThis.navigator?.locks;
        return locks ? await locks.request('yzc-Siyuan-reading:inbox-notebook', () => this.resolve()) : await this.resolve();
      };
      this.pending = resolve().finally(() => { this.pending = undefined; });
    }
    return this.pending;
  }

  private async resolve(): Promise<Notebook> {
    let notebook = await this.find();
    if (!notebook) {
      ({ notebook } = await kernel<{ notebook: Notebook }>('/api/notebook/createNotebook', { name: NAME }));
    } else if (notebook.closed) {
      await kernel('/api/notebook/openNotebook', { notebook: notebook.id });
      notebook = { ...notebook, closed: false };
    }
    const binding = await this.plugin.loadData(KEY);
    if (binding?.id !== notebook.id) await this.plugin.saveData(KEY, { id: notebook.id });
    return notebook;
  }

  async importTarget(pendingNotebook?: string): Promise<Notebook> {
    if (!pendingNotebook) return this.ensure();
    // An interrupted import resumes at its recorded path, including upgrades.
    const notebook = (await listNotebooks()).find(n => n.id === pendingNotebook && !n.closed);
    if (!notebook) throw new Error('待完成导入的笔记本暂不可用，请打开原笔记本后重试。');
    return notebook;
  }
}
