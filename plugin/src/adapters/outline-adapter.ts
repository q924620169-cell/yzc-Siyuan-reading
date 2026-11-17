export interface Heading { id: string; text: string; depth: number }
export interface OutlineNode {
  id: string; name?: string; nameIsHTML?: boolean; content?: string;
  subType?: string; blocks?: OutlineNode[]; children?: OutlineNode[];
}
export function flattenOutline(nodes: OutlineNode[], decode: (text: string, html: boolean) => string): Heading[] {
  const headings: Heading[] = [];
  const visit = (items: OutlineNode[], depth: number) => {
    for (const item of items) {
      headings.push({ id: item.id, text: decode(item.name || item.content || '', !!item.nameIsHTML), depth });
      visit(item.blocks ?? item.children ?? [], depth + 1);
    }
  };
  visit(nodes, 0); return headings;
}
export interface OutlineEditor { id: string; element: HTMLElement; content: HTMLElement }
export interface OutlineHost {
  editors(): OutlineEditor[];
  active(): HTMLElement | undefined;
  load(id: string): Promise<OutlineNode[]>;
  jump(id: string, editor: OutlineEditor): void;
  subscribe(refresh: (invalidate?: boolean) => void): () => void;
}
interface View { editor: OutlineEditor; nav: HTMLElement; headings: Heading[]; signature: string; current?: string; revision: number }

/** Both outline surfaces use the full document outline, including headings not loaded in the editor yet. */
export class OutlineAdapter {
  private views = new Map<HTMLElement, View>();
  private cache = new Map<string, Promise<Heading[]>>();
  private observer: MutationObserver;
  private unsubscribe: () => void;
  private frame = 0;
  private revision = 0;
  private disposed = false;
  private left?: HTMLElement;
  private leftSource?: View;
  private leftSignature = '';
  private requested?: { documentId: string; headingId: string };
  constructor(private host: OutlineHost, private doc: Document = document) {
    this.observer = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element && record.target.closest('.yzc-scrollspy,.yzc-outline-list')))) this.schedule();
    });
    this.observer.observe(doc.body, { childList: true, subtree: true, characterData: true });
    doc.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    this.unsubscribe = host.subscribe(invalidate => this.refresh(invalidate));
    this.refresh();
  }
  private onScroll = (): void => this.schedule();
  private schedule(): void {
    if (!this.disposed && !this.frame) this.frame = this.doc.defaultView!.requestAnimationFrame(() => { this.frame = 0; this.refresh(); });
  }
  refresh(invalidate = false): void {
    if (this.disposed) return;
    if (invalidate) { this.cache.clear(); this.revision++; }
    const editors = this.host.editors();
    for (const [element, view] of this.views) {
      if (!editors.some(editor => editor.element === element && editor.id === view.editor.id)) {
        view.nav.remove(); element.classList.remove('yzc-has-outline'); this.views.delete(element);
      }
    }
    for (const editor of editors) {
      let view = this.views.get(editor.element);
      if (!view) {
        const nav = this.doc.createElement('nav'); nav.className = 'yzc-scrollspy'; nav.setAttribute('aria-label', '文章定位'); nav.tabIndex = 0;
        editor.element.append(nav); editor.element.classList.add('yzc-has-outline');
        view = { editor, nav, headings: [], signature: '', revision: -1 }; this.views.set(editor.element, view);
      }
      view.editor = editor;
      if (view.revision !== this.revision) { view.revision = this.revision; void this.load(view, this.revision); }
      this.track(view);
    }
    this.renderLeft();
  }
  private async load(view: View, revision: number): Promise<void> {
    const id = view.editor.id;
    if (!this.cache.has(id)) this.cache.set(id, this.host.load(id).then(nodes => flattenOutline(nodes ?? [], (text, html) => {
      if (html) return new this.doc.defaultView!.DOMParser().parseFromString(text, 'text/html').body.textContent ?? '';
      // Nested heading content is entity-escaped plain text, not HTML markup.
      const textarea = this.doc.createElement('textarea'); textarea.innerHTML = text; return textarea.value;
    })));
    try {
      const headings = await this.cache.get(id)!;
      if (this.disposed || this.views.get(view.editor.element) !== view || revision !== this.revision) return;
      view.headings = headings;
      const signature = JSON.stringify(headings);
      if (signature !== view.signature) {
        view.signature = signature; this.fill(view.nav, view, true);
      }
      view.nav.hidden = !headings.length;
      this.track(view); this.renderLeft();
    } catch (error) {
      this.cache.delete(id);
      if (!this.disposed) console.warn('YZC: outline unavailable', error);
    }
  }
  private fill(container: HTMLElement, view: View, ticks: boolean): void {
    const fragment = this.doc.createDocumentFragment();
    const strip = this.doc.createElement('div'); strip.className = 'yzc-scrollspy-ticks'; strip.setAttribute('aria-hidden', 'true');
    const panel = this.doc.createElement('div'); panel.className = 'yzc-scrollspy-panel';
    for (const heading of view.headings) {
      const button = this.doc.createElement('button'); button.type = 'button';
      button.dataset.headingId = heading.id; button.style.setProperty('--yzc-heading-depth', String(heading.depth));
      button.setAttribute('aria-label', heading.text);
      if (ticks) {
        const tick = this.doc.createElement('span'); tick.className = 'yzc-heading-tick'; tick.dataset.tickId = heading.id;
        tick.style.setProperty('--yzc-heading-depth', String(heading.depth)); strip.append(tick);
      }
      const label = this.doc.createElement('span'); label.className = 'yzc-heading-label'; label.textContent = heading.text; button.append(label);
      button.addEventListener('click', () => this.jump(view, heading.id));
      if (ticks) panel.append(button); else fragment.append(button);
    }
    if (!ticks && !view.headings.length) {
      const empty = this.doc.createElement('div'); empty.className = 'yzc-outline-empty'; empty.textContent = '此文档暂无标题'; fragment.append(empty);
    }
    if (ticks) container.replaceChildren(strip, panel); else container.replaceChildren(fragment);
  }
  private jump(view: View, id: string): void {
    this.requested = undefined;
    const target = [...view.editor.content.querySelectorAll<HTMLElement>('[data-type="NodeHeading"][data-node-id]')].find(el => el.dataset.nodeId === id);
    if (target) {
      const content = view.editor.content;
      content.scrollTo({ top: content.scrollTop + target.getBoundingClientRect().top - content.getBoundingClientRect().top - 24, behavior: 'instant' });
    } else {
      this.requested = { documentId: view.editor.id, headingId: id };
      this.host.jump(id, view.editor);
    }
    this.mark(view, id); this.renderLeft();
  }
  private track(view: View): void {
    if (!view.headings.length) return;
    if (this.requested?.documentId === view.editor.id) {
      const id = this.requested.headingId;
      const target = [...view.editor.content.querySelectorAll<HTMLElement>('[data-type="NodeHeading"][data-node-id]')].find(el => el.dataset.nodeId === id);
      if (!target) { this.mark(view, id); return; }
      this.requested = undefined;
      this.jump(view, id);
    }
    const top = view.editor.content.getBoundingClientRect().top + 48;
    const positions = [...view.editor.content.querySelectorAll<HTMLElement>('[data-type="NodeHeading"][data-node-id]')]
      .map(el => ({ id: el.dataset.nodeId!, top: el.getBoundingClientRect().top }));
    const passed = positions.filter(item => item.top <= top).at(-1);
    const first = positions[0];
    const index = first ? view.headings.findIndex(h => h.id === first.id) : -1;
    const current = passed?.id ?? (index >= 0 ? view.headings[Math.max(0, index - 1)].id : view.current ?? view.headings[0].id);
    this.mark(view, current);
  }
  private mark(view: View, id: string): void {
    view.current = id;
    this.markButtons(view.nav, id);
    if (this.leftSource === view && this.left) this.markButtons(this.left, id);
  }
  private markButtons(container: HTMLElement, id?: string): void {
    for (const tick of container.querySelectorAll<HTMLElement>('[data-tick-id]')) tick.classList.toggle('yzc-heading-tick--current', tick.dataset.tickId === id);
    for (const button of container.querySelectorAll<HTMLElement>('[data-heading-id]')) {
      if (button.dataset.headingId === id) { if (button.getAttribute('aria-current') !== 'location') button.setAttribute('aria-current', 'location'); }
      else if (button.hasAttribute('aria-current')) button.removeAttribute('aria-current');
    }
  }
  private renderLeft(): void {
    const panel = this.doc.querySelector<HTMLElement>('.sy__outline');
    if (this.left?.parentElement !== panel) { this.left?.parentElement?.classList.remove('yzc-outline-panel'); this.left?.remove(); this.left = undefined; this.leftSource = undefined; }
    const view = this.views.get(this.host.active()!) ?? this.views.values().next().value as View | undefined;
    if (!panel) return;
    panel.classList.add('yzc-outline-panel');
    if (!this.left) { this.left = this.doc.createElement('nav'); this.left.className = 'yzc-outline-list'; this.left.setAttribute('aria-label', '文档大纲'); panel.append(this.left); }
    if (!view) { this.left.replaceChildren(); this.leftSource = undefined; return; }
    if (this.leftSource !== view || this.leftSignature !== view.signature) {
      this.leftSource = view; this.leftSignature = view.signature; this.fill(this.left, view, false); this.left.scrollTop = 0;
    }
    this.markButtons(this.left, view.current);
  }
  dispose(): void {
    this.disposed = true; this.unsubscribe(); this.observer.disconnect();
    this.doc.removeEventListener('scroll', this.onScroll, true);
    this.doc.defaultView!.cancelAnimationFrame(this.frame);
    for (const [element, view] of this.views) { view.nav.remove(); element.classList.remove('yzc-has-outline'); }
    this.views.clear(); this.left?.remove();
    this.doc.querySelectorAll('.yzc-outline-panel').forEach(panel => panel.classList.remove('yzc-outline-panel'));
  }
}
