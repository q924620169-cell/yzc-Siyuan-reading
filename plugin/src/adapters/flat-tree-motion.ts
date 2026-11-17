export interface FlatMotionEntry {
    element: HTMLElement;
    branch?: string;
}
interface Entry extends FlatMotionEntry {
    height: number;
    top: number;
    bottom: number;
    display: string;
    space: number;
    visible: boolean;
    saved?: Map<string, {
        value: string;
        priority: string;
    }>;
}
interface Range {
    entries: Entry[];
    from: number;
    to: number;
}
const timing = { duration: 170, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' as const };
const properties = ['display', 'visibility', 'transform', 'clip-path', 'pointer-events'];
/** Animate occupied space in the existing flat list. A shared reveal boundary
 * clips each branch from its bottom; native rows keep their size and ownership.
 * Native removal is deferred until the requested branch has reached zero. */
export class FlatTreeMotion {
    private entries = new Map<HTMLElement, Entry>();
    private closing = new Map<string, () => void>();
    private animation?: Animation;
    private frame?: number;
    private ranges: Range[] = [];
    private container?: HTMLElement;
    private waiting = false;
    private ordered: Entry[] = [];
    private containerStyle?: {
        height: string;
        overflow: string;
        heightPriority: string;
        overflowPriority: string;
        extra: number;
    };
    private media?: MediaQueryList;
    private reduced = () => { if (this.media?.matches)
        this.finish(); };
    constructor(private doc: Document) { }
    isClosing(key: string): boolean { return this.closing.has(key); }
    close(key: string, commit: () => void): void { this.closing.set(key, commit); }
    cancelClose(key: string): void { this.closing.delete(key); }
    private belongs(entry: FlatMotionEntry, key: string): boolean {
        return entry.branch === key || !!entry.branch?.startsWith(key + '/');
    }
    private save(entry: Entry): void {
        if (entry.saved)
            return;
        entry.saved = new Map(properties.map(property => [property, {
                value: entry.element.style.getPropertyValue(property),
                priority: entry.element.style.getPropertyPriority(property)
            }]));
    }
    private restore(entry: Entry): void {
        if (!entry.saved)
            return;
        for (const [property, style] of entry.saved) {
            if (style.value)
                entry.element.style.setProperty(property, style.value, style.priority);
            else
                entry.element.style.removeProperty(property);
        }
        entry.saved = undefined;
    }
    private full(entry: Entry): number { return entry.top + entry.height + entry.bottom; }
    private write(entry: Entry, property: string, value: string, priority = 'important'): void {
        const style = entry.element.style;
        if (style.getPropertyValue(property) === value && (!value || style.getPropertyPriority(property) === priority))
            return;
        if (value) style.setProperty(property, value, priority);
        else style.removeProperty(property);
    }
    private original(entry: Entry, property: string): void {
        const saved = entry.saved?.get(property);
        this.write(entry, property, saved?.value ?? '', saved?.priority ?? '');
    }
    private paint(entry: Entry): void {
        const full = this.full(entry);
        this.save(entry);
        const top = Math.min(entry.top, entry.space);
        const visible = Math.max(0, Math.min(entry.height, entry.space - top));
        this.write(entry, 'display', entry.display);
        // Only the reveal boundary needs a clip. Thousands of fully clipped
        // rows otherwise create costly paint layers in the native flat list.
        if (visible <= .01) {
            this.write(entry, 'visibility', 'hidden');
            this.original(entry, 'clip-path');
        } else if (entry.height - visible > .01) {
            this.original(entry, 'visibility');
            this.write(entry, 'clip-path', `inset(0px 0px ${entry.height - visible}px 0px)`);
        } else {
            this.original(entry, 'visibility');
            this.original(entry, 'clip-path');
        }
        if (entry.space < full - .01)
            this.write(entry, 'pointer-events', 'none');
        else this.original(entry, 'pointer-events');
    }
    private apply(progress: number): void {
        for (const range of this.ranges) {
            let space = range.from + (range.to - range.from) * progress;
            for (const entry of range.entries) {
                entry.space = Math.max(0, Math.min(this.full(entry), space));
                space -= this.full(entry);
            }
        }
        let hidden = 0, total = 0;
        for (const entry of this.ordered) {
            this.paint(entry);
            // Fully clipped rows need no moving layer. Most rows in a long
            // branch remain either fully revealed or fully clipped each frame.
            if (hidden > .01 && entry.space > .01)
                this.write(entry, 'transform', `translateY(${-hidden}px)`);
            else this.original(entry, 'transform');
            const full = this.full(entry);
            total += full;
            hidden += full - entry.space;
        }
        if (this.container && this.containerStyle) {
            this.container.style.setProperty('height', (total - hidden + this.containerStyle.extra) + 'px', 'important');
            this.container.style.setProperty('overflow', 'clip', 'important');
        }
    }
    private progress(): number {
        return Number(this.animation?.effect?.getComputedTiming().progress ?? 0);
    }
    private tick = (): void => {
        if (!this.animation)
            return;
        this.apply(this.progress());
        this.frame = this.doc.defaultView!.requestAnimationFrame(this.tick);
    };
    private stop(): void {
        if (this.frame !== undefined)
            this.doc.defaultView!.cancelAnimationFrame(this.frame);
        this.frame = undefined;
        const animation = this.animation;
        this.animation = undefined;
        animation?.cancel();
        this.media?.removeEventListener('change', this.reduced);
        this.media = undefined;
    }
    private commitClosed(): void {
        for (const [key, commit] of this.closing) {
            if ([...this.entries.values()].some(entry => this.belongs(entry, key) && entry.element.isConnected && entry.space > .01))
                continue;
            this.closing.delete(key);
            commit();
        }
    }
    finish(): void {
        this.apply(1);
        this.stop();
        this.ranges = [];
        this.waiting = false;
        this.commitClosed();
        this.entries.forEach(entry => this.restore(entry));
        this.restoreContainer();
    }
    private restoreContainer(): void {
        if (!this.container || !this.containerStyle)
            return;
        const saved = this.containerStyle;
        if (saved.height)
            this.container.style.setProperty('height', saved.height, saved.heightPriority);
        else
            this.container.style.removeProperty('height');
        if (saved.overflow)
            this.container.style.setProperty('overflow', saved.overflow, saved.overflowPriority);
        else
            this.container.style.removeProperty('overflow');
        this.containerStyle = undefined;
    }
    sync(container: HTMLElement, elements: FlatMotionEntry[], animate: boolean, ready = true): void {
        if (this.container && this.container !== container)
            this.dispose();
        const initial = !this.container;
        this.container = container;
        const running = !!this.animation;
        const requested = animate || running || this.waiting;
        if (running)
            this.apply(this.progress());
        const next = new Set(elements.map(entry => entry.element));
        let changed = false;
        for (const [el, entry] of this.entries)
            if (!next.has(el) || !el.isConnected) {
                this.restore(entry);
                this.entries.delete(el);
                changed = true;
            }
        // Restore outgoing rows to their natural display for one batched
        // measurement pass. Font loading can change header and row heights.
        if (requested) {
            for (const entry of this.entries.values()) {
                if (entry.visible && entry.element.classList.contains('yzc-role-hidden') && !entry.saved) {
                    this.save(entry);
                    entry.element.style.setProperty('display', entry.display, 'important');
                }
            }
        }
        const ordered: Entry[] = [];
        for (const item of elements) {
            const el = item.element;
            if (!el.isConnected)
                continue;
            const visible = !el.classList.contains('yzc-role-hidden')
                && ![...this.closing.keys()].some(key => this.belongs(item, key));
            let entry = this.entries.get(el);
            if (!entry) {
                const style = this.doc.defaultView!.getComputedStyle(el);
                const height = el.getBoundingClientRect().height;
                if (!height && !visible)
                    continue;
                entry = { ...item, height, top: parseFloat(style.marginTop) || 0, bottom: parseFloat(style.marginBottom) || 0,
                    display: style.display === 'none' ? 'flex' : style.display, space: 0, visible: false };
                this.entries.set(el, entry);
            }
            entry.branch = item.branch;
            const measured = el.getBoundingClientRect().height;
            if (measured > 0 && Math.abs(measured - entry.height) > .1) {
                const previousFull = this.full(entry);
                const fraction = previousFull ? entry.space / previousFull : Number(entry.visible);
                entry.height = measured;
                entry.space = this.full(entry) * fraction;
                changed = true;
            }
            if (entry.visible !== visible) {
                entry.visible = visible;
                changed = true;
            }
            ordered.push(entry);
        }
        if (!changed && running && ready)
            return;
        if (!changed && !requested) {
            this.commitClosed();
            return;
        }
        this.stop();
        if (initial || !requested || this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !container.getClientRects().length) {
            for (const entry of ordered) {
                entry.space = entry.visible ? this.full(entry) : 0;
                this.restore(entry);
            }
            this.ranges = [];
            this.waiting = false;
            this.commitClosed();
            this.restoreContainer();
            return;
        }
        this.ranges = [];
        let range: Range | undefined;
        for (const entry of ordered) {
            const target = entry.visible ? this.full(entry) : 0;
            if (Math.abs(entry.space - target) < .01) {
                range = undefined;
                continue;
            }
            if (!range || (range.to > range.from) !== entry.visible) {
                range = { entries: [], from: 0, to: 0 };
                this.ranges.push(range);
            }
            range.entries.push(entry);
            range.from += entry.space;
            range.to += target;
        }
        if (!this.ranges.length) {
            this.waiting = false;
            this.commitClosed();
            this.entries.forEach(entry => this.restore(entry));
            this.restoreContainer();
            return;
        }
        const active = new Set(this.ranges.flatMap(range => range.entries));
        this.ordered = ordered.filter(entry => entry.space > .01 || entry.visible || active.has(entry));
        if (!this.containerStyle) {
            const style = container.style, computed = this.doc.defaultView!.getComputedStyle(container);
            const extra = computed.boxSizing === 'border-box'
                ? (parseFloat(computed.paddingTop) || 0) + (parseFloat(computed.paddingBottom) || 0) + (parseFloat(computed.borderTopWidth) || 0) + (parseFloat(computed.borderBottomWidth) || 0) : 0;
            this.containerStyle = { height: style.getPropertyValue('height'), overflow: style.getPropertyValue('overflow'),
                heightPriority: style.getPropertyPriority('height'), overflowPriority: style.getPropertyPriority('overflow'), extra };
        }
        this.apply(0);
        this.waiting = !ready;
        if (this.waiting)
            return;
        const animation = container.animate([], timing);
        // Large native projections can take a frame to lay out. Start the
        // clock only after that initial geometry is ready to be painted.
        animation.pause();
        animation.currentTime = 0;
        this.animation = animation;
        this.media = this.doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
        this.media?.addEventListener('change', this.reduced);
        void animation.finished.then(() => { if (this.animation === animation)
            this.finish(); }, () => { });
        this.frame = this.doc.defaultView!.requestAnimationFrame(() => {
            if (this.animation !== animation) return;
            animation.play();
            this.frame = this.doc.defaultView!.requestAnimationFrame(this.tick);
        });
    }
    dispose(): void {
        this.finish();
        this.entries.forEach(entry => this.restore(entry));
        this.entries.clear();
        this.closing.clear();
        this.ordered = [];
        this.container = undefined;
    }
}
