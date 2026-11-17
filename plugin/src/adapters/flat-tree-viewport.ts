import { ROW, ROOT } from './native-tree-dom';

/** The 3.8.10 host virtualizes by native index. INL reorders by role, so its
 * scroll viewport must contain every row in the expanded native branches.
 * Keep the native list and rows in place and let SiYuan load/render them. */
export class FlatTreeViewport {
  private scroller: HTMLElement;
  private rowHeight = 0;
  private renderBudget = 0;
  private disposed = false;

  constructor(readonly items: HTMLElement, readonly list: HTMLElement) {
    const scrollTop = items.scrollTop;
    this.scroller = items.ownerDocument.createElement('div');
    this.scroller.className = 'yzc-flat-scroll fn__flex-1';
    items.before(this.scroller);
    this.scroller.append(items);
    items.classList.add('yzc-flat-tree');
    // Include collapsed INL rows and native spacers in the measured range.
    // SiYuan still owns row creation, loading, selection and tree events.
    const view = items.ownerDocument.defaultView!;
    Object.defineProperty(items, 'clientHeight', {
      configurable: true,
      get: () => {
        const style = view.getComputedStyle(items);
        const first = list.querySelector<HTMLElement>(`${ROW}, ${ROOT}`);
        const measured = first?.getBoundingClientRect().height ?? 0;
        if (measured > 0) this.rowHeight = measured;
        // Match the host's real row metric. A CSS fallback can under-budget a
        // long range and leave permanent virtual spacers after an INL fold.
        const rowHeight = this.rowHeight || parseFloat(style.getPropertyValue('--b3-ui-list-height')) || 28;
        const rowStyle = first && view.getComputedStyle(first);
        const spacing = rowStyle ? (parseFloat(rowStyle.marginTop) || 0) + (parseFloat(rowStyle.marginBottom) || 0) : 0;
        const height = rowHeight + spacing;
        let total = 0;
        for (const child of list.children) {
          const el = child as HTMLElement;
          total += el.dataset.treeSpacer || el.dataset.treeAnimation
            ? parseFloat(el.style.height) || 0 : height;
        }
        return Math.ceil(total + height);
      }
    });
    this.scroller.scrollTop = scrollTop;
    // A dock can be hidden at startup, so ResizeObserver may not fire until
    // it is shown. Request the same render the host performs after scrolling.
    items.dispatchEvent(new view.Event('scroll'));
  }

  materialize(): void {
    if (!this.list.querySelector('[data-tree-spacer]')) {
      this.renderBudget=0;
      return;
    }
    const budget=this.items.clientHeight;
    if (budget===this.renderBudget) return;
    this.renderBudget=budget;
    // A reveal intentionally holds physical height while native rows load.
    // Request the host range render when its logical budget has changed.
    queueMicrotask(()=>{
      if (!this.disposed && this.items.isConnected)
        this.items.dispatchEvent(new this.items.ownerDocument.defaultView!.Event('scroll'));
    });
  }

  dispose(): void {
    this.disposed=true;
    const scrollTop = this.scroller.scrollTop;
    Reflect.deleteProperty(this.items, 'clientHeight');
    this.items.classList.remove('yzc-flat-tree');
    if (this.items.parentElement === this.scroller) this.scroller.replaceWith(this.items);
    else this.scroller.remove();
    this.items.scrollTop = scrollTop;
  }
}
