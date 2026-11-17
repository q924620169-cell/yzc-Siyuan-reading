import type { TreeGroup, TreeHost } from '../inl/inl-controller';
import type { Projection, Role } from '../inl/inl-tree';
import type { CountNode } from '../enhancements/notebook-counts';
import { FocusTreeAdapter } from './focus-tree-adapter';
import { TreeMotion } from './tree-motion';
import { FlatTreeMotion, type FlatMotionEntry } from './flat-tree-motion';
import { FlatTreeViewport } from './flat-tree-viewport';
import { TREE, ITEMS, ROW, ROOT, canExpand, flatList, flatRows, isExpanded, nodeId, notebookId, occurrence, parentOccurrence, scopeKey } from './native-tree-dom';

const MIME = 'application/x-yzc-inl';
interface Binding { group: TreeGroup; list?: HTMLElement; owner: HTMLElement; entries: Map<string, HTMLElement>; flat?: HTMLElement }
interface ProjectionInstance { owner: HTMLElement; list: HTMLElement; sections: Map<Role, HTMLElement>; hint?: HTMLElement }
export interface NodeState {
  id: string; parent?: string; children: string[]; depth: number;
  active: boolean; selected: boolean; hover: boolean; expanded: boolean; collapsed: boolean;
}
interface Actions {
  refresh(): void;
  repaint?(): void;
  toggleScope(): void;
  changeRole(key: string, id: string, role: Role): void;
  create(group: TreeGroup, role: Role): void;
}

/** CSS order changes presentation only. We never clone/reparent native rows.
 * Observer, selectors, native events, selection and DnD stay in this adapter.
 */
export class DocumentTreeAdapter implements TreeHost {
  private observer: MutationObserver;
  private timer?: ReturnType<typeof setTimeout>;
  private selected?: string | null;
  private bindings: Binding[] = [];
  private flatViewports = new Map<HTMLElement, FlatTreeViewport>();
  private instances = new Map<string, ProjectionInstance>();
  private orders = new Map<HTMLElement, string>();
  private collapsed = new Map<string, boolean>();
  private singleSection = false;
  private legacyControls = true;
  configureLegacyControls(enabled:boolean):void {this.legacyControls=enabled;if(!enabled){this.buttons.forEach(button=>button.remove());this.buttons.clear();}}
  private drag?: { key: string; id: string };
  private disposed = false;
  private buttons = new Set<HTMLButtonElement>();
  private events = new AbortController();
  private focus: FocusTreeAdapter;
  private returnTarget?:string;
  private motion: TreeMotion;
  private flatMotion: FlatTreeMotion;
  private nativeCommits = new WeakSet<HTMLElement>();
  private automaticCloses = new WeakSet<HTMLElement>();
  private requestedNotebook?: string | null;
  private resetOnOpen = new Set<string>();
  private focusTransition = false;
  private flatTransition = false;
  private paintRevision = 0;
  constructor(private actions: Actions, private root: Document = document) {
    this.motion=new TreeMotion(root);
    this.flatMotion=new FlatTreeMotion(root);
    this.focus=new FocusTreeAdapter(root,(closedScope)=>{
      this.resetScope(closedScope);this.focusTransition=true;
      this.selected=this.focus.ownerId;this.paintFocus();this.actions.refresh();
    });
    this.observer = new MutationObserver(records => {
      if (records.some(record => this.relevant(record))) {
        this.folderStates(records);
        // Mutation delivery precedes paint: reuse known scope/role data now.
        if (!this.drag) {
          const revision=this.paintRevision;
          this.actions.repaint?.();
          // Global INL OFF has no controller repaint, but normal folders still
          // use exactly the same native animation timing and final measurement.
          if(this.legacyControls && revision===this.paintRevision) {
            this.groups();this.motion.settle(this.bindings.map(b=>({list:b.list,settled:true})),this.focus.enabled);
          }
        }
        this.schedule(records.some(record => record.type === 'childList') ? 0 : 100);
      }
    });
    this.observe();
    root.addEventListener('click', this.onClick, { capture: true, signal: this.events.signal });
    root.addEventListener('contextmenu', this.onClick, { capture: true, signal: this.events.signal });
    for (const type of ['dragstart', 'dragover', 'drop', 'dragend'] as const) root.addEventListener(type, this.onDrag, { capture: true, signal: this.events.signal });
    this.schedule();
  }
  private relevant(record: MutationRecord): boolean {
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    if (target?.closest(TREE)) return true;
    return [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches(TREE) || node.querySelector(TREE)));
  }
  private observe(): void {
    if (!this.disposed) this.observer.observe(this.root.body, { childList: true, subtree: true, attributes: true, attributeOldValue:true, attributeFilter: ['class', 'data-node-id', 'data-tree-key', 'data-path', 'data-count', 'data-name'] });
  }
  private mutate(action: () => void): void { this.observer.disconnect(); try { action(); } finally { this.observe(); } }
  private schedule(delay = 100): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { if (!this.disposed && !this.drag) { this.mountButtons(); this.actions.refresh(); } }, delay);
  }
  private onClick = (event: MouseEvent): void => {
    if(!this.legacyControls)return;
    const target = event.target as Element;
    if (target.closest('.yzc-section, .yzc-crowded')) return;
    const row = target.closest<HTMLElement>(`${ROW}, ${ROOT}`);
    if (row && this.nativeCommits.has(row)) { this.nativeCommits.delete(row); return; }
    const automaticClose=!!row && this.automaticCloses.has(row);
    if(row)this.automaticCloses.delete(row);
    if (row?.closest(TREE) && row.closest(ITEMS)) {
      if (event.type==='click' && event.button===0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey
        && !target.closest('.b3-list-item__text,.b3-list-item__toggle,.b3-list-item__icon,.b3-list-item__action,.b3-list-item__switch,button,a,input,select,textarea,[contenteditable]')) {
        const title=row.querySelector<HTMLElement>('.b3-list-item__text');
        if(title) {
          // Padding and count space share the title's activation path. Native
          // blank-row expansion otherwise bypasses the latest notebook intent.
          title.click();
          event.preventDefault();event.stopImmediatePropagation();return;
        }
      }
      this.selected = nodeId(row); this.schedule();
      const occurrenceKey=occurrence(row);
      const items=row.closest<HTMLElement>(ITEMS)!;
      if (event.type==='click' && occurrenceKey && this.flatViewports.has(items)
        && target.closest('.b3-list-item__toggle') && canExpand(row)) {
        if(this.singleSection && row.matches(ROOT) && !automaticClose) {
          this.requestedNotebook=this.flatMotion.isClosing(occurrenceKey)
            || (!isExpanded(row) && row.getAttribute('aria-busy')!=='true') ? occurrenceKey : null;
        }
        if (this.flatMotion.isClosing(occurrenceKey)) {
          this.flatMotion.cancelClose(occurrenceKey);
          if(this.singleSection && row.matches(ROOT))this.closeOtherNotebooks(row);
          this.flatTransition=true;this.actions.repaint?.();this.actions.refresh();
          event.preventDefault();event.stopImmediatePropagation();return;
        }
        if (isExpanded(row)) {
          this.flatMotion.close(occurrenceKey,()=>queueMicrotask(()=>{
            const owner=row.isConnected ? row : [...this.root.querySelectorAll<HTMLElement>(`${TREE} [data-tree-key]`)].find(el=>occurrence(el)===occurrenceKey);
            if(!owner || !isExpanded(owner))return;
            this.nativeCommits.add(owner);
            owner.querySelector<HTMLElement>('.b3-list-item__toggle')?.click();
          }));
          this.flatTransition=true;this.actions.repaint?.();this.actions.refresh();
          event.preventDefault();event.stopImmediatePropagation();return;
        }
        this.flatTransition=true;
      }
      if (event.type === 'click' && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && target.closest('.b3-list-item__text')) {
        if(this.focus.enabled && canExpand(row)) {
          this.focusTransition=true;
          this.focus.enter(row);
          if(row.matches(ROOT)) {
            this.revealScope(nodeId(row)!);this.paintFocus();this.actions.refresh();event.preventDefault();event.stopImmediatePropagation();
          } else queueMicrotask(()=>{
            // Finish the host's open-document click before its source row leaves
            // the visible scope. A microtask still commits before the next paint.
            if(!this.disposed){this.revealScope(nodeId(row)!);this.paintFocus();this.actions.refresh();}
          });
          return;
        }
        // Preserve the host's document-open handler. A hidden native toggle still
        // owns loading/collapsing children; notebook titles are containers only.
        if (row.matches(ROOT)) {
          row.querySelector<HTMLElement>('.b3-list-item__toggle')?.click();
          event.preventDefault(); event.stopImmediatePropagation();
        } else if (canExpand(row) && !occurrence(row)) {
          // Native expansion can replace the row. Finish the original document
          // click before expanding, in the same turn and before the next paint.
          queueMicrotask(() => {
            if (this.disposed) return;
            const current=row.isConnected ? row : [...this.root.querySelectorAll<HTMLElement>(`${TREE} ${ROW}`)].find(node=>node.dataset.nodeId===row.dataset.nodeId);
            current?.querySelector<HTMLElement>('.b3-list-item__toggle')?.click();
          });
        }
      }
    }
    else if (target.closest('.file-tree__items')) { this.selected = null; this.scopeState(undefined, false); }
  };
  private mountButtons(): void {
    if(!this.legacyControls)return;
    this.mutate(() => {
      for (const button of this.buttons) if (!button.isConnected) this.buttons.delete(button);
      for (const tree of this.root.querySelectorAll(TREE)) {
        const header = tree.querySelector('.block__icons');
        if (!header || header.querySelector('.yzc-scope-toggle')) continue;
        const button = this.root.createElement('button');
        button.type = 'button'; button.className = 'block__icon yzc-scope-toggle';
        button.textContent = 'INL'; button.disabled = true; button.title = '请选择一个节点以设置局部 INL';
        button.onclick = event => { event.stopPropagation(); this.actions.toggleScope(); };
        header.insertBefore(button, header.querySelector('[data-type="min"]'));
        this.buttons.add(button);
      }
    });
  }
  current(): string | undefined {
    if(this.focus.enabled)return this.focus.ownerId;
    if (!this.selected) return undefined;
    const rows = [...this.root.querySelectorAll<HTMLElement>(`${TREE} ${ROW}, ${TREE} ${ROOT}`)];
    if (this.selected && rows.some(row => nodeId(row) === this.selected)) return this.selected;
    this.selected = null;
    return undefined;
  }
  private resetScope(key: string): void {
    for (const role of ['now','library','inbox']) this.collapsed.delete(`${key}/${role}`);
    this.resetOnOpen.delete(key);
  }
  private folderStates(records: MutationRecord[]): void {
    for(const record of records) {
      if(record.type!=='attributes'||record.attributeName!=='class'||!(record.target instanceof Element))continue;
      const arrow=record.target;
      if(!arrow.classList.contains('b3-list-item__arrow'))continue;
      const row=arrow.closest<HTMLElement>(`${ROOT},${ROW}`);
      if(!row?.closest(TREE))continue;
      const wasOpen=record.oldValue?.split(/\s+/).includes('b3-list-item__arrow--open');
      const open=arrow.classList.contains('b3-list-item__arrow--open');
      const key=scopeKey(row);
      if(!key)continue;
      if (!!wasOpen !== open && this.flatViewports.has(row.closest<HTMLElement>(ITEMS)!)) this.flatTransition = true;
      // Do not change the outgoing DOM while the native close animation runs.
      // Apply the reset before the next opening projection is measured instead.
      if(wasOpen&&!open)this.resetOnOpen.add(key);
      else if(!wasOpen&&open) {
        if(this.resetOnOpen.has(key))this.resetScope(key);
        if(this.singleSection && row.matches(ROOT)) {
          const key=occurrence(row);
          if(key && this.requestedNotebook!==undefined && key!==this.requestedNotebook) {
            // A slower open can finish after a newer user choice. Cancel that
            // stale host expansion before it displaces the requested notebook.
            this.nativeCommits.add(row);
            row.querySelector<HTMLElement>('.b3-list-item__toggle')?.click();
          } else this.closeOtherNotebooks(row);
        }
      }
    }
  }
  configureFocus(enabled:boolean):void {
    if(enabled===this.focus.enabled)return;
    this.focusTransition=true;
    if(!enabled)this.returnTarget=this.focus.ownerId;
    this.mutate(()=>this.focus.configure(enabled,this.selected));
    if(enabled && this.focus.ownerId)this.revealScope(this.focus.ownerId);
    this.paintFocus();this.actions.refresh();
  }
  configureSingleSection(enabled:boolean):void {
    if(enabled===this.singleSection)return;
    this.singleSection=enabled;
    if(!enabled)this.requestedNotebook=undefined;
    if(enabled)for(const [key,instance] of this.instances) {
      const open=(['now','library','inbox'] as Role[]).filter(role=>instance.sections.get(role)?.querySelector('button')?.getAttribute('aria-expanded')==='true');
      this.openOnly(key,open[0]);
    }
    if(enabled)for(const tree of this.root.querySelectorAll(TREE)) {
      const first=[...tree.querySelectorAll<HTMLElement>(`${ROOT}:has(.b3-list-item__arrow--open)`)]
        .find(row=>!this.flatMotion.isClosing(occurrence(row)??''));
      if(first){this.requestedNotebook=occurrence(first);this.closeOtherNotebooks(first);}
    }
    this.actions.repaint?.();this.actions.refresh();
  }
  private closeOtherNotebooks(owner:HTMLElement):void {
    const selected=this.selected;
    for(const row of owner.closest(TREE)!.querySelectorAll<HTMLElement>(ROOT)) {
      if(row!==owner && row.querySelector('.b3-list-item__arrow--open') && !this.flatMotion.isClosing(occurrence(row) ?? '')) {
        this.automaticCloses.add(row);
        row.querySelector<HTMLElement>('.b3-list-item__toggle')?.click();
        // A repaint disconnects the observer in this turn; retain this close
        // before that transaction can discard its queued native class record.
        const key=scopeKey(row);
        if(key && !isExpanded(row))this.resetOnOpen.add(key);
      }
    }
    // Host toggles still own loading/motion; closing a sibling must not select it.
    this.selected=selected;
  }
  private openOnly(key:string,role?:Role):void {
    for(const item of ['now','library','inbox'])this.collapsed.set(`${key}/${item}`,item!==role);
  }
  private paintFocus():void {
    this.actions.repaint?.();
    this.mutate(()=>this.focus.present(this.bindings.map(b=>({...b,list:this.instances.get(b.group.key)?.list??b.list}))));
  }
  private depth(row:HTMLElement):number {
    if (occurrence(row)) return occurrence(row)!.split('/').length - 1;
    let depth=0;
    for(let parent=row.parentElement;parent&&!parent.matches('.file-tree__items');parent=parent.parentElement)
      if(parent.tagName==='UL'&&!parent.hasAttribute('data-url'))depth++;
    return depth;
  }
  scopeState(id: string | undefined, enabled: boolean): void {
    const node = id ? [...this.root.querySelectorAll<HTMLElement>(`${TREE} ${ROW}, ${TREE} ${ROOT}`)].find(row => nodeId(row) === id) : undefined;
    const name = node?.dataset.name || node?.querySelector('.b3-list-item__text')?.textContent || id;
    for (const button of this.buttons) {
      button.disabled = !id; button.setAttribute('aria-pressed', String(!!id && enabled));
      const title = !id ? '请明确选中一个节点以设置局部 INL' : `${enabled ? '关闭' : '启用'}「${name}」的 INL`;
      button.title = title; button.setAttribute('aria-label', title);
    }
  }
  revealScope(id: string): void {
    // Let the native host load this node's children; never seek a parent scope.
    const owner = [...this.root.querySelectorAll<HTMLElement>(`${TREE} ${ROW}, ${TREE} ${ROOT}`)].find(row => nodeId(row) === id);
    if (owner && canExpand(owner) && !isExpanded(owner)) owner.querySelector<HTMLElement>('.b3-list-item__toggle')?.click();
  }
  resetSections(): void { this.collapsed.clear(); this.resetOnOpen.clear(); }
  scopeIds(): string[] {
    return [...this.root.querySelectorAll<HTMLElement>(`${TREE} ${ROW}, ${TREE} ${ROOT}`)].flatMap(row => nodeId(row) || []);
  }
  countNodes(): CountNode[] {
    return [...this.root.querySelectorAll<HTMLElement>(`${TREE} ${ROW}, ${TREE} ${ROOT}`)].flatMap(row => {
      const id = nodeId(row);
      if (!id) return [];
      return row.matches(ROOT) ? {id,notebook:notebookId(row)}
        : {id,count:row.hasAttribute('data-count') ? Number(row.dataset.count) : undefined};
    });
  }
  showCounts(counts: ReadonlyMap<string, number>): void {
    this.mutate(() => {
      for (const row of this.root.querySelectorAll<HTMLElement>(`${TREE} ${ROW}, ${TREE} ${ROOT}`)) {
        const count = counts.get(nodeId(row)!);
        let label = row.querySelector<HTMLElement>(':scope > .yzc-child-count');
        if (count === undefined) { label?.remove(); continue; }
        if (!label) {
          label = this.root.createElement('span'); label.className = 'yzc-child-count';
          row.querySelector('.b3-list-item__text')?.after(label);
        }
        if (label.textContent !== String(count)) label.textContent = String(count);
        label.setAttribute('aria-label', `${count} 个直接子文档`);
      }
    });
  }
  stage(keys: Set<string>): void {
    this.mutate(() => {
      for (const binding of this.bindings) if (binding.list) binding.list.classList.toggle('yzc-inl-pending', keys.has(binding.group.key) && (!this.focus.enabled || binding.group.key===this.focus.key));
    });
  }
  private flatGroups(items: HTMLElement, list: HTMLElement): Binding[] {
    const rows = flatRows(list);
    const children = new Map<string | undefined, HTMLElement[]>();
    for (const row of rows) {
      const parent = parentOccurrence(row);
      const siblings = children.get(parent) ?? [];
      siblings.push(row);
      children.set(parent, siblings);
    }
    const bind = (owner: HTMLElement, key: string, notebook: string, entries: HTMLElement[], parentId?: string): Binding => {
      const byId = new Map<string, HTMLElement>();
      for (const row of entries) {
        const id = nodeId(row);
        if (id) byId.set(id, row);
      }
      const nodes = [...byId].map(([id, row]) => ({id, name: row.querySelector('.b3-list-item__text')?.textContent || id}));
      return {owner, flat: items, entries: byId, group: {key, notebook, parentId, nodes}};
    };
    const bindings = [bind(items, 'root', '', children.get(undefined) ?? [])];
    for (const row of rows) {
      const key = scopeKey(row);
      if (!key) continue;
      const entries = children.get(occurrence(row)) ?? [];
      if (!entries.length && canExpand(row) && !isExpanded(row)) continue;
      if (isExpanded(row) && this.resetOnOpen.has(key)) this.resetScope(key);
      bindings.push(bind(row, key, notebookId(row)!, entries, row.matches(ROW) ? nodeId(row) : undefined));
    }
    return bindings;
  }
  groups(): TreeGroup[] {
    const bindings: Binding[] = [];
    for (const tree of this.root.querySelectorAll(TREE)) {
      const rootList = tree.querySelector<HTMLElement>('.file-tree__items');
      if (rootList) {
        const list = flatList(rootList);
        if (list) {
          bindings.push(...this.flatGroups(rootList, list));
          continue;
        }
        const entries = new Map([...rootList.querySelectorAll<HTMLElement>(':scope > ul[data-url]')].filter(el => el.querySelector(ROOT)).map(el => [`notebook:${el.dataset.url}`,el]));
        bindings.push({owner:rootList,list:rootList,entries,group:{key:'root',notebook:'',nodes:[...entries].map(([id,el])=>({id,name:el.querySelector(`${ROOT} .b3-list-item__text`)?.textContent ?? id}))}});
      }
      for (const owner of tree.querySelectorAll<HTMLElement>(`.file-tree__items ${ROOT}, .file-tree__items ${ROW}`)) {
        const notebook = notebookId(owner);
        if (!notebook) continue;
        const next = owner.nextElementSibling;
        const list = next?.tagName === 'UL' && !next.classList.contains('yzc-empty-list') ? next as HTMLElement : undefined;
        const parentId = owner.matches(ROW) ? owner.dataset.nodeId : undefined;
        const key=`${notebook}/${parentId ?? ''}`;
        if(this.resetOnOpen.has(key) && owner.querySelector('.b3-list-item__arrow--open'))this.resetScope(key);
        const nodes = list ? [...list.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.matches(ROW)).map(el => ({ id: el.dataset.nodeId!, name: el.dataset.name || el.querySelector('.b3-list-item__text')?.textContent || '' })) : [];
        // Collapsed parents with unloaded children are handled when the host expands them.
        if (!list && Number(owner.dataset.count) > 0) continue;
        if (!list && owner.matches(ROOT) && !owner.querySelector('.b3-list-item__arrow--open')) continue;
        const entries = new Map(list ? [...list.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.matches(ROW)).map(el => [el.dataset.nodeId!,el]) : []);
        bindings.push({ owner, list, entries, group: { key, notebook, parentId, nodes } });
      }
    }
    // A pinned/duplicated host pane can expose the same scope more than once.
    this.bindings = [...new Map(bindings.map(b => [b.group.key, b])).values()];
    return this.bindings.map(b => b.group);
  }
  nodeStates(): NodeState[] {
    return [...this.root.querySelectorAll<HTMLElement>(`${TREE} ${ROW}`)].map(row => {
      const list = row.parentElement;
      const parent = list?.previousElementSibling;
      const children = row.nextElementSibling;
      const depth=this.depth(row);
      const flat = occurrence(row);
      const key = scopeKey(row);
      return { id: row.dataset.nodeId!, parent: flat ? parentOccurrence(row)?.split('/').slice(1).at(-1) : parent?.matches(ROW) ? (parent as HTMLElement).dataset.nodeId : undefined,
        children: flat ? this.bindings.find(binding => binding.group.key === key)?.group.nodes.map(node => node.id) ?? []
          : children?.tagName === 'UL' ? [...children.querySelectorAll<HTMLElement>(`:scope > ${ROW}`)].map(el => el.dataset.nodeId!) : [],
        depth, active: row.classList.contains('b3-list-item--focus'), selected: row.classList.contains('b3-list-item--selected') || row.dataset.nodeId === this.current(),
        hover: row.matches(':hover'), expanded: !!row.querySelector('.b3-list-item__arrow--open'), collapsed: !row.querySelector('.b3-list-item__arrow--open') };
    });
  }
  private clearDecoration(): void {
    for (const [el, order] of this.orders) { if (order) el.style.order = order; else el.style.removeProperty('order'); }
    this.orders.clear();
    this.root.querySelectorAll('[style*="--yzc-tree-depth"]').forEach(el => (el as HTMLElement).style.removeProperty('--yzc-tree-depth'));
    this.root.querySelectorAll('.yzc-child-list').forEach(el=>{el.classList.remove('yzc-child-list');(el as HTMLElement).style.removeProperty('--yzc-guide-inset');});
    this.root.querySelectorAll('.yzc-scope-list').forEach(el => (el as HTMLElement).style.removeProperty('--yzc-content-inset'));
    this.root.querySelectorAll('.yzc-scope-list, .yzc-role-hidden, .yzc-inl-item, .yzc-inl-leaf, .yzc-inl-pending').forEach(el => el.classList.remove('yzc-scope-list', 'yzc-role-hidden', 'yzc-inl-item', 'yzc-inl-leaf', 'yzc-inl-pending'));
    this.root.querySelectorAll('[data-yzc-item]').forEach(el=>el.removeAttribute('data-yzc-item'));
    this.root.querySelectorAll('[data-yzc-group], [data-svs-role], [data-yzc-scope-id]').forEach(el => { el.removeAttribute('data-yzc-group'); el.removeAttribute('data-svs-role'); el.removeAttribute('data-yzc-scope-id'); el.removeAttribute('data-yzc-parent-id'); });
  }
  private removeInstance(instance: ProjectionInstance): void {
    instance.sections.forEach(header => header.remove());
    instance.hint?.remove();
    if (instance.list.classList.contains('yzc-empty-list')) instance.list.remove();
  }
  private clean(): void {
    this.flatMotion.dispose();
    this.flatTransition = false;
    this.requestedNotebook=undefined;
    this.clearDecoration();
    this.flatViewports.forEach(viewport => viewport.dispose());
    this.flatViewports.clear();
    this.instances.forEach(instance => this.removeInstance(instance)); this.instances.clear();
    this.root.querySelectorAll('.yzc-section, .yzc-empty-list, .yzc-crowded').forEach(el => el.remove());
  }
  restore(): void { this.motion.dispose(); this.drag = undefined; this.clearDrag(); this.mutate(() => this.clean()); }
  private order(el: HTMLElement, value: number): void { if (!this.orders.has(el)) this.orders.set(el, el.style.order); el.style.order = String(value); }
  private layoutFlat(items: HTMLElement, list: HTMLElement, views: ReadonlyMap<string, Projection>): FlatMotionEntry[] {
    let position = 0;
    const entries: FlatMotionEntry[]=flatRows(list).map(element=>({element,branch:parentOccurrence(element)}));
    const bindings = new Map(this.bindings.filter(binding => binding.flat === items).map(binding => [binding.group.key, binding]));
    const focused = this.focus.enabled;
    // The host wrapper animates native indexes, which do not match INL order.
    // Complete native cleanup; the flat projection owns occupied-space motion.
    for (const animation of list.querySelectorAll<HTMLElement>('[data-tree-animation]'))
      for (const effect of animation.getAnimations?.() ?? []) if (effect.playState === 'running') effect.finish();
    for (const row of flatRows(list)) row.classList.add('yzc-role-hidden');
    const place = (key: string, hidden: boolean) => {
      const binding = bindings.get(key);
      if (!binding) return;
      const projection = views.get(key);
      const row = (id: string, collapsed: boolean) => {
        const entry = binding.entries.get(id);
        if (!entry) return;
        this.order(entry, position++);
        entry.classList.toggle('yzc-role-hidden', collapsed);
        const child = scopeKey(entry);
        if (!focused && child) place(child, collapsed);
      };
      if (projection?.mode !== 'inl') {
        for (const id of binding.entries.keys()) row(id, hidden);
        return;
      }
      const instance = this.instances.get(key)!;
      for (const section of projection.sections) {
        const header = instance.sections.get(section.role)!;
        entries.push({element:header,branch:occurrence(binding.owner)});
        this.order(header, position++);
        header.classList.toggle('yzc-role-hidden', hidden);
        const collapsed = this.collapsed.get(`${key}/${section.role}`) ?? section.collapsed;
        for (const node of section.nodes) row(node.id, hidden || collapsed);
        if (section.role === 'now' && instance.hint) {
          entries.push({element:instance.hint,branch:occurrence(binding.owner)});
          this.order(instance.hint, position++);
          instance.hint.classList.toggle('yzc-role-hidden', hidden || collapsed);
        }
      }
    };
    place(focused ? this.focus.key : 'root', false);
    return entries.sort((a,b)=>Number(a.element.style.order)-Number(b.element.style.order));
  }
  present(views: { group: TreeGroup; projection: Projection }[], colors: boolean): void {
    if(!this.legacyControls){
      // The unified document navigation filters the original native tree.
      // Old INL ordering, focus, folder-click and motion hooks stay inactive.
      this.mutate(()=>{
        for(const row of this.root.querySelectorAll<HTMLElement>(`${TREE} ${ROOT},${TREE} ${ROW}`)){
          const depth=String(this.depth(row));if(row.style.getPropertyValue('--yzc-tree-depth')!==depth)row.style.setProperty('--yzc-tree-depth',depth);
          if(colors){if(row.dataset.svsRole!=='library')row.dataset.svsRole='library';}else delete row.dataset.svsRole;
        }
      });return;
    }
    // Keep live drop targets stable until dragend triggers a fresh projection.
    if (this.drag) return;
    this.paintRevision++;
    this.mutate(() => {
      this.clearDecoration();
      if(this.focus.enabled)views=views.map(view=>view.group.key===this.focus.key?view:{...view,projection:{mode:'normal',nodes:view.group.nodes}});
      const projections = new Map(views.map(view => [view.group.key, view.projection]));
      const flatRoot = this.bindings.find(binding => binding.flat && binding.group.key === 'root')?.flat;
      const flat = flatRoot && (projections.get('root')?.mode === 'inl' || this.focus.enabled
        || (!projections.has('root') && this.flatViewports.has(flatRoot))) ? flatRoot : undefined;
      const nativeList = flat && flatList(flat);
      for (const [items, viewport] of this.flatViewports) if (items !== flat || viewport.list !== nativeList) {
        viewport.dispose();
        this.flatViewports.delete(items);
      }
      if (flat && nativeList && !this.flatViewports.has(flat))
        this.flatViewports.set(flat, new FlatTreeViewport(flat, nativeList));
      const desired = new Map(this.bindings.filter(binding => binding.owner.isConnected && views.some(view => view.group.key === binding.group.key && view.projection.mode === 'inl')).map(binding => [binding.group.key,binding]));
      for (const [key,instance] of this.instances) {
        const binding = desired.get(key);
        if (!binding || binding.owner !== instance.owner || !instance.list.isConnected || (binding.list && binding.list !== instance.list) || (!binding.flat && key !== 'root' && binding.owner.nextElementSibling !== instance.list)) {
          this.removeInstance(instance); this.instances.delete(key);
        }
      }
      // Delete orphaned/legacy projection nodes, including host clones. They are
      // never retained as hidden DOM and never become a second owner of a scope.
      const retained = new Set<HTMLElement>();
      for (const instance of this.instances.values()) { retained.add(instance.list); instance.sections.forEach(header => retained.add(header)); if (instance.hint) retained.add(instance.hint); }
      this.root.querySelectorAll<HTMLElement>('.yzc-section,.yzc-empty-list,.yzc-crowded').forEach(el => { if (!retained.has(el)) el.remove(); });
      for (const row of this.root.querySelectorAll<HTMLElement>(`${TREE} ${ROOT},${TREE} ${ROW}`)) {
        row.style.setProperty('--yzc-tree-depth',String(this.depth(row)));
        const child=row.nextElementSibling;
        if(child instanceof HTMLElement && child.tagName==='UL') {
          child.classList.add('yzc-child-list');child.style.setProperty('--yzc-guide-inset',`${28+this.depth(row)*12}px`);
        }
      }
      for (const binding of this.bindings) {
        if (!binding.owner.isConnected) continue;
        const view = views.find(v => v.group.key === binding.group.key);
        if (!view) continue;
        const roles = new Map(view.group.nodes.map(node => [node.id, node.role ?? 'library']));
        if (colors) for (const [id,entry] of binding.entries) { const row = binding.group.key === 'root' && !binding.flat ? entry.querySelector<HTMLElement>(ROOT)! : entry; row.dataset.svsRole = roles.get(id) ?? 'library'; }
        if (view.projection.mode !== 'inl') continue;
        let instance = this.instances.get(binding.group.key);
        let list = instance?.list ?? binding.flat ?? binding.list;
        if (!list) {
          list = this.root.createElement('ul'); list.className = 'yzc-empty-list'; binding.owner.after(list);
        }
        if (!instance) { instance={owner:binding.owner,list,sections:new Map()}; this.instances.set(binding.group.key,instance); }
        // Empty local scopes follow their exact owner in order and visibility.
        if (list.classList.contains('yzc-empty-list')) {
          if (binding.owner.style.order) this.order(list,Number(binding.owner.style.order)+1);
          list.classList.toggle('yzc-role-hidden',binding.owner.classList.contains('yzc-role-hidden'));
        }
        if (!binding.flat || binding.group.key === 'root') {
          list.classList.add('yzc-scope-list');
          list.dataset.yzcGroup = binding.group.key;
          list.dataset.yzcScopeId = binding.group.key;
          if (binding.group.parentId) list.dataset.yzcParentId = binding.group.parentId;
        }
        if (!binding.flat && binding.group.key !== 'root') {
          // Same 12px structural step for normal children and Local INL;
          // notebook wrappers and icon width never become extra indentation.
          const offset = 28+(this.depth(binding.owner)+1)*12;
          list.style.setProperty('--yzc-content-inset', `${offset}px`);
        }
        // Resolve a focus-return target before painting any section, so a
        // single-section scope never exposes an intermediate two-open state.
        if(this.returnTarget && this.singleSection) {
          const target=view.projection.sections.find(section=>section.nodes.some(node=>node.id===this.returnTarget || binding.entries.get(node.id)?.querySelector(`[data-node-id="${this.returnTarget}"]`) || binding.entries.get(node.id)?.nextElementSibling?.querySelector(`[data-node-id="${this.returnTarget}"]`)));
          if(target)this.openOnly(binding.group.key,target.role);
        }
        for (const [index, section] of view.projection.sections.entries()) {
          const collapseKey = `${binding.group.key}/${section.role}`;
          if(!this.singleSection && this.returnTarget && section.nodes.some(node=>node.id===this.returnTarget || binding.entries.get(node.id)?.nextElementSibling?.querySelector(`[data-node-id="${this.returnTarget}"]`) || (binding.group.key==='root' && binding.entries.get(node.id)?.querySelector(`[data-node-id="${this.returnTarget}"]`))))this.collapsed.set(collapseKey,false);
          const collapsed = this.collapsed.get(collapseKey) ?? section.collapsed;
          let header = instance.sections.get(section.role);
          if (!header) { header=this.root.createElement('div'); instance.sections.set(section.role,header); }
          header.className = 'yzc-section'; header.dataset.yzcRole = section.role; header.dataset.yzcGroup = binding.group.key;
          if (binding.flat && binding.group.key !== 'root') {
            header.classList.add('yzc-flat-local');
            header.style.setProperty('--yzc-content-inset', `${28+(this.depth(binding.owner)+1)*12}px`);
          }
          header.style.order = String(index * 1000000);
          let toggle = header.querySelector<HTMLButtonElement>('button');
          if (!toggle) { toggle=this.root.createElement('button'); toggle.type='button'; header.append(toggle); }
          toggle.textContent = `${section.role.toUpperCase()}  ${section.nodes.length}`;
          toggle.setAttribute('aria-expanded', String(!collapsed));
          toggle.onclick = event => {
            event.stopPropagation();
            const commit = () => {
              if (binding.flat) this.flatTransition = true;
              if(this.singleSection && collapsed)this.openOnly(binding.group.key,section.role);
              else this.collapsed.set(collapseKey,!collapsed);
              // Existing roles are known: commit the entire target in this
              // turn, before TreeMotion measures either outgoing/incoming row.
              // A fold changes visibility only. A second metadata refresh
              // repeats the full projection and can consume the reveal frames.
              if(this.actions.repaint)this.actions.repaint();
              else this.actions.refresh();
            };
            if (binding.flat) commit();
            else this.motion.change([...list.children].filter((el):el is HTMLElement=>el instanceof HTMLElement&&!el.classList.contains('yzc-section')), commit);
          };
          if (binding.group.key !== 'root') {
            let add=header.querySelector<HTMLButtonElement>('button:nth-child(2)');
            if (!add) { add=this.root.createElement('button'); add.type='button'; add.textContent='+'; header.append(add); }
            add.setAttribute('aria-label',`在 ${section.role.toUpperCase()} 新建文档`);
            add.onclick=event=>{event.stopPropagation();this.actions.create(binding.group,section.role);};
          }
          if (header.parentElement !== list) list.append(header);
          if (section.role === 'now') {
            if ((!collapsed || binding.flat) && section.nodes.length >= 6) {
              const hint=instance.hint ?? this.root.createElement('div'); instance.hint=hint;
              hint.className='yzc-crowded'; hint.textContent='Now is getting crowded'; hint.dataset.yzcRole='now';hint.dataset.yzcGroup=binding.group.key;
              if (binding.flat && binding.group.key !== 'root') {
                hint.classList.add('yzc-flat-hint');
                hint.style.setProperty('--yzc-content-inset', `${28+(this.depth(binding.owner)+1)*12}px`);
              }
              hint.style.order=String(index*1000000+section.nodes.length*2+3); if(hint.parentElement!==list)list.append(hint);
            } else { instance.hint?.remove(); instance.hint=undefined; }
          }
          section.nodes.forEach((node, position) => {
            const entry = binding.entries.get(node.id);
            if (!entry) return;
            const row = binding.group.key === 'root' && !binding.flat ? entry.querySelector<HTMLElement>(ROOT)! : entry;
            const child = binding.group.key === 'root' ? null : row.nextElementSibling;
            row.dataset.yzcGroup = binding.group.key;
            row.dataset.yzcItem = node.id;
            row.classList.add('yzc-inl-item');
            row.classList.toggle('yzc-inl-leaf', row.matches(ROW) && !canExpand(row));
            if (binding.flat) return;
            this.order(entry, index * 1000000 + position * 2 + 1);
            entry.classList.toggle('yzc-role-hidden', collapsed);
            if (child instanceof HTMLElement && child.tagName === 'UL') {
              this.order(child, index * 1000000 + position * 2 + 2); child.classList.toggle('yzc-role-hidden', collapsed);
            }
          });
        }
      }
      const flatEntries=flat && nativeList ? this.layoutFlat(flat, nativeList, projections) : [];
      this.focus.present(this.bindings.map(b=>({...b,list:this.instances.get(b.group.key)?.list??b.list})));
      if (flat && nativeList) {
        this.flatViewports.get(flat)?.materialize();
        const ready=!nativeList.querySelector('[data-tree-spacer],[data-tree-loading]')
          && this.bindings.filter(binding=>binding.flat===flat).every(binding=>projections.has(binding.group.key));
        this.flatMotion.sync(flat,flatEntries,this.flatTransition && !this.focusTransition,ready);
      }
      this.flatTransition=false;
      this.motion.settle(this.bindings.map(b=>({list:b.list,settled:views.some(v=>v.group.key===b.group.key)})),this.focus.enabled);
      if(this.focusTransition && (!this.focus.enabled || views.some(v=>v.group.key===this.focus.key))) {
        this.focusTransition=false;
        this.root.querySelectorAll<HTMLElement>(`${TREE} .file-tree__items`).forEach(el=>{
          if (flatList(el)) { this.flatMotion.finish();this.motion.reveal(el); }
          else this.motion.fade(el);
        });
      }
      if(this.returnTarget) {
        const row=[...this.root.querySelectorAll<HTMLElement>(`${TREE} ${ROW},${TREE} ${ROOT}`)].find(row=>nodeId(row)===this.returnTarget);
        row?.scrollIntoView?.({block:'nearest'});this.selected=this.returnTarget;this.returnTarget=undefined;
      }
    });
  }
  private onDrag = (event: DragEvent): void => {
    if(!this.legacyControls)return;
    const target = event.target as Element;
    if (event.type === 'dragend') { this.drag = undefined; this.clearDrag(); this.schedule(); return; }
    const row = target.closest<HTMLElement>('[data-yzc-item]');
    const section = target.closest<HTMLElement>('.yzc-section');
    if (event.type === 'dragstart' && row) {
      this.drag = { key: row.dataset.yzcGroup!, id: row.dataset.yzcItem! };
      event.stopImmediatePropagation();
      event.dataTransfer?.setData(MIME, JSON.stringify(this.drag));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      row.classList.add('yzc-dragging'); return;
    }
    // Block all host drop handlers for an INL source, including outside its own tree.
    if (this.drag || ((row || section) && event.type !== 'dragstart')) {
      event.preventDefault(); event.stopImmediatePropagation();
      this.clearDrag();
      const valid = this.drag && section?.dataset.yzcGroup === this.drag.key;
      if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? 'move' : 'none';
      if (valid && section) section.classList.add('yzc-drop-target');
      if (event.type === 'drop') {
        const drag = this.drag; this.drag = undefined; this.clearDrag();
        if (valid && drag && section) this.actions.changeRole(drag.key, drag.id, section.dataset.yzcRole as Role);
      }
    }
  };
  private clearDrag(): void { this.root.querySelectorAll('.yzc-drop-target, .yzc-dragging').forEach(el => el.classList.remove('yzc-drop-target', 'yzc-dragging')); }
  dispose(): void {
    this.disposed = true; clearTimeout(this.timer); this.observer.disconnect(); this.events.abort();
    this.motion.dispose();this.resetOnOpen.clear();
    this.clean(); this.clearDrag(); this.buttons.forEach(button => button.remove()); this.buttons.clear();
    this.focus.dispose();
    this.root.querySelectorAll('.yzc-child-count').forEach(el => el.remove());
  }
}
