export interface CountNode { id: string; notebook?: string; count?: number }
export interface CountHost {
  countNodes(): CountNode[];
  showCounts(counts: ReadonlyMap<string, number>): void;
}
/** Notebook rows lack reliable counts; document rows already expose direct subFileCount.
 * Shares the document-tree adapter and its lifecycle, without another tree observer.
 */
export class NotebookCounts {
  private enabled = false;
  private disposed = false;
  private generation = 0;
  private cache = new Map<string, Promise<number>>();
  constructor(private host: CountHost, private load: (notebook: string) => Promise<number>) {}
  configure(enabled: boolean): void {
    if (enabled === this.enabled) { void this.refresh(); return; }
    this.enabled = enabled; this.generation++; this.cache.clear();
    if (enabled) void this.refresh(); else this.host.showCounts(new Map());
  }
  async refresh(invalidate = false): Promise<void> {
    if (this.disposed || !this.enabled) return;
    if (invalidate) { this.generation++; this.cache.clear(); }
    const generation = this.generation;
    const roots = this.host.countNodes().filter(node => node.notebook);
    const counts = new Map<string, number>();
    await Promise.all(roots.map(async node => {
      if (!this.cache.has(node.notebook!)) this.cache.set(node.notebook!, this.load(node.notebook!));
      const request = this.cache.get(node.notebook!)!;
      try { counts.set(node.id, await request); }
      catch { if (this.cache.get(node.notebook!) === request) this.cache.delete(node.notebook!); } // Unknown is omitted, never displayed as a false zero.
    }));
    if (this.disposed || !this.enabled || generation !== this.generation) return;
    for (const node of this.host.countNodes()) if (!node.notebook && node.count !== undefined && node.count > 0) counts.set(node.id, node.count);
    this.host.showCounts(counts);
  }
  dispose(): void { this.disposed = true; this.generation++; this.cache.clear(); this.host.showCounts(new Map()); }
}
