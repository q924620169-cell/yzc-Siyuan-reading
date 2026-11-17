import type { TreeAdapter } from './inl-adapter';
import { projectTree, type Scope } from './inl-tree';

/** Serializes switches so an older async render cannot overwrite a later OFF. */
export class InlManager {
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  constructor(private readonly adapter: TreeAdapter) {}
  switchView(enabled: boolean, scope: Scope): Promise<void> {
    const task = this.queue.then(async () => {
      if (this.disposed) return;
      if (!enabled) { this.adapter.restore(); return; }
      try {
        const nodes = await this.adapter.readChildren(scope);
        if (this.disposed) return;
        const projection = projectTree(nodes, scope, enabled);
        if (projection.mode === 'normal') this.adapter.restore();
        else await this.adapter.replaceView(projection);
        if (this.disposed) this.adapter.restore();
      } catch (error) {
        this.adapter.restore();
        throw error;
      }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  dispose(): void {
    this.disposed = true;
    this.adapter.restore();
  }
}
