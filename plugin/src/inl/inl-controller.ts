import { projectTree, type Role, type Scope, type TreeNode } from './inl-tree';
import type { InlStorage } from './inl-storage';
import type { CreatedDocument } from '../adapters/host-events-adapter';

export interface TreeGroup {
  key: string; notebook: string; parentId?: string; nodes: TreeNode[];
}
export interface TreeHost {
  groups(): TreeGroup[];
  present(groups: { group: TreeGroup; projection: ReturnType<typeof projectTree> }[], colors: boolean): void;
  restore(): void;
  current(): string | undefined;
  scopeState(id: string | undefined, enabled: boolean): void;
  revealScope?(id: string): void;
  resetSections?(): void;
  scopeIds?(): string[];
  stage?(keys: Set<string>): void;
}
/** No DOM operations: the host owns layout, node identity and native interactions. */
export class InlController {
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private disposed = false;
  private enabled = false;
  private colored = false;
  private scopes = new Map<string, boolean>();
  private roles = new Map<string, Map<string, Role | undefined>>();
  constructor(private host: TreeHost, private storage: InlStorage, private report: (error: unknown) => void) {}
  private enqueue(work: () => Promise<void>): Promise<void> {
    const task = this.queue.then(async () => { if (!this.disposed) await work(); });
    this.queue = task.catch(this.report);
    return task;
  }
  /** Synchronous projection for host mutation delivery, before the next paint.
   * No network, timer, or guessed role for a newly loaded item.
   */
  repaint(invalidate = true): void {
    if (this.disposed || !this.enabled) return;
    if (invalidate) ++this.generation;
    const groups = this.host.groups();
    const pending = new Set<string>();
    const views = [];
    for (const group of groups) {
      const owner = group.parentId ?? `notebook:${group.notebook}`;
      const enabled = group.key === 'root' || this.scopes.get(owner) === true;
      const roles = this.roles.get(group.key);
      if (enabled && group.nodes.some(node => !roles?.has(node.id))) { pending.add(group.key); continue; }
      const nodes = group.nodes.map(node => ({...node,role:roles?.get(node.id)}));
      views.push({group:{...group,nodes},projection:projectTree(nodes,group.key === 'root' ? {kind:'root'} : {kind:'document',id:owner,enabled},this.enabled)});
    }
    this.host.present(views,this.colored);
    this.host.stage?.(pending);
  }
  async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.repaint(false);
    const groups = this.host.groups();
    if(!this.enabled) {
      this.host.present(groups.map(group=>({group,projection:projectTree(group.nodes,{kind:'root'},false)})),this.colored);
      this.host.scopeState(undefined,false);return;
    }
    // Read opt-in even for collapsed/unloaded owners, before their first expansion.
    const ids = [...new Set([...(this.host.scopeIds?.() ?? []),...groups.filter(g => g.key !== 'root').map(g => g.parentId ?? `notebook:${g.notebook}`)])];
    const selected = this.host.current(); if (selected && !ids.includes(selected)) ids.push(selected);
    try {
      const states = new Map<string, Awaited<ReturnType<InlStorage['read']>>>();
      // Bound concurrency for large native trees.
      for (let i = 0; i < ids.length; i += 12) {
        await Promise.all(ids.slice(i, i + 12).map(async id => states.set(id, await this.storage.read(id))));
        if (generation !== this.generation || this.disposed) return;
      }
      const views = await Promise.all(groups.map(async group => {
        const owner = group.parentId ?? `notebook:${group.notebook}`;
        const scope: Scope = group.key === 'root' ? {kind:'root'} : { kind: 'document', id: owner, enabled: states.get(owner)?.enabled === true };
        const nodes: TreeNode[] = [];
        for (let i=0;i<group.nodes.length;i+=12) nodes.push(...await Promise.all(group.nodes.slice(i,i+12).map(async node => ({...node,role:(await this.storage.read(node.id,group.key)).role}))));
        // Global mode owns Root; local scopes remain explicitly opted in.
        return { group: { ...group, nodes }, projection: projectTree(nodes, scope, this.enabled) };
      }));
      if (generation !== this.generation || this.disposed) return;
      for (const [id,state] of states) this.scopes.set(id,state.enabled);
      for (const view of views) {
        let roles = this.roles.get(view.group.key);
        if (!roles) { roles = new Map(); this.roles.set(view.group.key,roles); }
        for (const node of view.group.nodes) roles.set(node.id,node.role);
      }
      this.host.present(views, this.colored);
      this.host.scopeState(selected, selected ? states.get(selected)?.enabled === true : false);
    } catch (error) {
      if (generation === this.generation && !this.disposed) { this.host.restore(); this.report(error); }
    }
  }
  configure(enabled: boolean, colored: boolean): void {
    if (enabled && !this.enabled) this.host.resetSections?.();
    this.enabled = enabled; this.colored = colored;
    ++this.generation;
    if (!enabled) this.host.restore();
    void this.refresh();
  }
  toggleScope(): Promise<void> {
    const id = this.host.current();
    if (!id) return Promise.resolve();
    return this.enqueue(async () => {
      const state = await this.storage.read(id);
      await this.storage.setScope(id, !state.enabled);
      this.scopes.set(id,!state.enabled);
      if (!state.enabled) this.host.revealScope?.(id);
      await this.refresh();
    });
  }
  changeRole(groupKey: string, id: string, role: Role): Promise<void> {
    return this.enqueue(async () => {
      if (!this.enabled) return;
      const group = this.host.groups().find(g => g.key === groupKey);
      if (!group?.nodes.some(n => n.id === id)) throw new Error('只能在同一目录内改变 INL 归属');
      if (group.key !== 'root' && !(await this.storage.read(group.parentId ?? `notebook:${group.notebook}`)).enabled) return;
      await this.storage.setRole(group.key, id, role); await this.refresh();
    });
  }
  created(doc: CreatedDocument): void {
    void this.enqueue(async () => {
      const key = `${doc.notebook}/${doc.parentId ?? ''}`;
      const state = await this.storage.read(doc.id,key);
      if (state.role) return;
      if ((await this.storage.read(doc.parentId ?? `notebook:${doc.notebook}`)).enabled) await this.storage.setRole(key, doc.id, 'inbox');
      await this.refresh();
    }).catch(() => {});
  }
  create(group: TreeGroup, role: Role, create: () => Promise<string>): Promise<void> {
    return this.enqueue(async () => {
      if (!this.enabled) return;
      if (group.key === 'root') return;
      if (!(await this.storage.read(group.parentId ?? `notebook:${group.notebook}`)).enabled) throw new Error('此目录已关闭 INL');
      const id = await create();
      try { await this.storage.setRole(group.key, id, role); }
      catch { throw new Error(`文档已创建（${id}），归属保存失败；请拖入目标分区，不要重复创建。`); }
      await this.refresh();
    });
  }
  dispose(): void { this.disposed = true; ++this.generation; this.host.restore(); }
}
