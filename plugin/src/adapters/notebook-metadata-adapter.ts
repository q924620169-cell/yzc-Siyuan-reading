import type { Plugin } from 'siyuan';
import type { NotebookMetadata, NotebookStore } from '../inl/inl-storage';
/** Notebooks are not blocks, so their scope metadata belongs to workspace plugin data. */
export class NotebookMetadataAdapter implements NotebookStore {
  private queue: Promise<void> = Promise.resolve();
  constructor(private plugin: Plugin) {}
  private async all(): Promise<Record<string, NotebookMetadata>> {
    const value = await this.plugin.loadData('inl-notebooks.json');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  async read(id: string): Promise<NotebookMetadata> { return (await this.all())[id] ?? {}; }
  write(id: string, data: NotebookMetadata): Promise<void> {
    const task=this.queue.then(async () => {const all=await this.all(); await this.plugin.saveData('inl-notebooks.json',{...all,[id]:data});});
    this.queue=task.catch(()=>{}); return task;
  }
}
