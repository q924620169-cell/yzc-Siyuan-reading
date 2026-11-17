import { Plugin, showMessage } from 'siyuan';
import { migratePluginStorage } from './adapters/storage-migration';
import { normalizeSettings, type Settings } from './settings';
import { applyPreset } from './style/preset-manager';
import { applyEnhancements } from './enhancements/enhancement-manager';
import { TopbarAdapter } from './adapters/topbar-adapter';
import { DocumentTreeAdapter } from './adapters/document-tree-adapter';
import { HostEventsAdapter } from './adapters/host-events-adapter';
import { attributes, DocumentApi } from './adapters/document-attribute-adapter';
import { InlStorage } from './inl/inl-storage';
import { InlController } from './inl/inl-controller';
import { requestDocumentTitle } from './adapters/create-dialog';
import { NotebookMetadataAdapter } from './adapters/notebook-metadata-adapter';
import { ShellLayoutAdapter } from './adapters/shell-layout-adapter';
import { OutlineAdapter } from './adapters/outline-adapter';
import { outlineHost } from './adapters/outline-host';
import { NotebookCounts } from './enhancements/notebook-counts';
import { SsdToastAdapter } from './adapters/ssd-toast-adapter';
import { WindowAdapter } from './adapters/window-adapter';
import { windowHost } from './adapters/window-host';
import type { WindowState } from './windows/window-model';
import { ToolBridge } from './adapters/tool-bridge';
import { SpaceNavigation } from './adapters/space-navigation';
import { DocumentNavigation } from './adapters/document-navigation';
import {NavigationPreferences,ORDER_KEY} from './navigation-order';
import Reader from '../../modules/reader/src/index.js';
import Rss from '../../modules/rss/src/index';
import {migrateModules} from '../../shared/storage-migration';
const KEY = 'settings.json';
const ATTRS = ['data-sv-theme', 'data-style', 'data-typography', 'data-inl', 'data-colored-headings', 'data-colored-tree', 'data-colored-tabs'];
export default class YZCPlugin extends Plugin {
  reader?: Reader;
  rss?: Rss;
  private preferences = normalizeSettings(null);
  private previous = new Map<string, string | null>();
  private disposed = false;
  private saveQueue: Promise<void> = Promise.resolve();
  private topbar?: TopbarAdapter;
  private tree?: DocumentTreeAdapter;
  private controller?: InlController;
  private events?: HostEventsAdapter;
  private shell?: ShellLayoutAdapter;
  private outline?: OutlineAdapter;
  private counts?: NotebookCounts;
  private started = false;
  private migration = new AbortController();
  private toast?: SsdToastAdapter;
  private ready = false;
  private loaded = false;
  private dialogs = new Set<() => void>();
  private windows?: WindowAdapter;
  private bridge?: ToolBridge;
  private spaces?: SpaceNavigation;
  private documents?: DocumentNavigation;
  private navigation?:NavigationPreferences;
  private navigationState:unknown;
  private windowState: unknown;
  private windowSaveQueue: Promise<void> = Promise.resolve();
  private stylesheet?: HTMLElement;
  private previousPlugin: string | null = null;
  private report = (error: unknown): void => { if (!this.disposed) showMessage(`yzc-INL：${error instanceof Error ? error.message : String(error)}`, 6000, 'error'); };
  async onload(): Promise<void> {
    const languages=(window as unknown as {siyuan?:{languages?:{kernel?:Record<string,string>}}}).siyuan?.languages;
    this.toast=new SsdToastAdapter(document,languages?.kernel?.['278']);
    try { await migratePluginStorage(this.name, this.migration.signal); await migrateModules(this.migration.signal); }
    catch (error) {
      if (!this.disposed) { this.report(new Error(`配置迁移未完成，请检查旧配置后重新启用插件：${error instanceof Error ? error.message : String(error)}`)); this.onunload(); }
      return;
    }
    if (this.disposed) return;
    try { this.preferences = normalizeSettings(await this.loadData(KEY)); }
    catch (error) { this.report(error); }
    try { this.windowState = await this.loadData('windows.json'); }
    catch (error) { this.report(error); }
    try { this.navigationState=await this.loadData(ORDER_KEY); }
    catch(error){this.report(error);}
    if (this.disposed) return;
    try {
      this.reader = new Reader(this); this.rss = new Rss(this);
      await this.reader.onload();
      if(this.disposed)return;
      await this.rss.onload();
    } catch(error) { this.report(error); this.onunload(); return; }
    if(this.disposed)return;
    this.loaded = true; this.startLifecycle();
  }
  onLayoutReady(): void {
    this.ready = true; this.startLifecycle();
  }
  private startLifecycle(): void {
    if (!this.disposed && this.loaded && this.ready && !this.started) {
      this.started=true;
      this.previousPlugin=document.documentElement.getAttribute('data-yzc-plugin');
      document.documentElement.setAttribute('data-yzc-plugin','');
      this.topbar = new TopbarAdapter(this, () => this.preferences, patch => this.update(patch));
      window.addEventListener('pagehide', this.onPageHide);
      this.mount();
      this.reader?.onLayoutReady(); this.rss?.onLayoutReady();
    }
  }
  private mount(): void {
    if (this.disposed || this.tree) return;
    if (this.stylesheet && !this.stylesheet.isConnected) document.head.append(this.stylesheet);
    for (const attr of ATTRS) this.previous.set(attr, document.documentElement.getAttribute(attr));
    this.apply();
    const api = new DocumentApi(this);
    this.shell = new ShellLayoutAdapter();
    this.outline = new OutlineAdapter(outlineHost(this));
    this.tree = new DocumentTreeAdapter({
      refresh: () => { void this.controller?.refresh(); void this.counts?.refresh(); },
      repaint: () => { this.controller?.repaint(); },
      toggleScope: () => { void this.controller?.toggleScope().catch(() => {}); },
      changeRole: (key, id, role) => { void this.controller?.changeRole(key, id, role).catch(() => {}); },
      create: (group, role) => {
        this.dialogs.add(requestDocumentTitle(async title => {
          await this.controller?.create(group, role, async () => {
            const id = await api.create(group, title); api.open(id); return id;
          });
        }));
      },
    });
    this.controller = new InlController(this.tree, new InlStorage(attributes(), new NotebookMetadataAdapter(this)), this.report);
    this.tree.configureLegacyControls(false);
    this.counts = new NotebookCounts(this.tree, notebook => api.countNotebook(notebook));
    this.events = new HostEventsAdapter(this, () => { void this.controller?.refresh(); }, () => {}, () => { void this.counts?.refresh(true); });
    this.controller.configure(false, this.preferences.coloredTree);
    this.tree.configureSingleSection(false);
    this.tree.configureFocus(false);
    this.counts.configure(this.preferences.notebookCounts);
    this.windows = new WindowAdapter(windowHost(this), this.windowState, state => this.saveWindows(state), this.report);
    this.navigation=new NavigationPreferences(this.navigationState,state=>this.saveData(ORDER_KEY,state),this.report);
    this.spaces = new SpaceNavigation(this.windows,document,this.navigation);
    this.documents = new DocumentNavigation(this,()=>this.windows?.selectDocuments(),this.report,document,this.navigation);
    this.bridge = new ToolBridge(this,this.windows,()=>this.preferences.inlEnabled,document,id=>this.documents!.refreshImported(id));
  }
  private saveWindows(state: WindowState): void {
    if (JSON.stringify(this.windowState) === JSON.stringify(state)) return;
    this.windowState = state;
    this.windowSaveQueue = this.windowSaveQueue.then(() => this.saveData('windows.json', state)).then(() => {}, this.report);
  }
  private update(patch: Partial<Settings>): Promise<void> {
    const task = this.saveQueue.then(async () => {
      if (this.disposed) return;
      const next = normalizeSettings({ ...this.preferences, ...patch });
      await this.saveData(KEY, next); this.preferences = next;
      if(!this.disposed)this.topbar?.render();
      if (!this.disposed && this.tree) {
        this.apply();
        this.tree.configureSingleSection(false);
        this.tree.configureFocus(false);
        this.controller?.configure(false, next.coloredTree);
        this.counts?.configure(next.notebookCounts);
      }
    });
    this.saveQueue = task.catch(this.report); return task;
  }
  private apply(): void {
    document.documentElement.setAttribute('data-sv-theme', this.preferences.style);
    applyPreset(document.documentElement, this.preferences.style);
    document.documentElement.setAttribute('data-typography', this.preferences.typography);
    applyEnhancements(document.documentElement, this.preferences);
    document.documentElement.setAttribute('data-inl', 'false');
  }
  private unmount(): void {
    this.stylesheet = document.getElementById('pluginsStyleyzc-INL') ?? this.stylesheet;
    this.stylesheet?.remove();
    this.documents?.dispose();this.documents=undefined;this.spaces?.dispose();this.spaces=undefined;
    this.navigation?.dispose();this.navigation=undefined;
    this.events?.dispose(); this.controller?.dispose(); this.counts?.dispose(); this.tree?.dispose(); this.shell?.dispose();
    this.outline?.dispose();
    this.bridge?.dispose();this.bridge=undefined;
    this.windows?.dispose(); this.windows = undefined;
    this.dialogs.forEach(close => close()); this.dialogs.clear();
    this.events = undefined; this.controller = undefined; this.counts = undefined;
    this.tree = undefined; this.shell = undefined; this.outline = undefined;
    for (const [attr, value] of this.previous) {
      if (value === null) document.documentElement.removeAttribute(attr); else document.documentElement.setAttribute(attr, value);
    }
    this.previous.clear();
  }
  /** SiYuan 3.8.8 otherwise reloads the whole plugin after another frontend saves data.
   * Keep this frontend's live windows; apply settings and refresh role projections in place. */
  async onDataChanged(): Promise<void> {
    if (this.disposed || !this.loaded) return;
    this.navigationState=await this.loadData(ORDER_KEY);
    if(this.disposed)return;
    this.navigation?.replace(this.navigationState);
    const next = normalizeSettings(await this.loadData(KEY));
    if (this.disposed) return;
    if (JSON.stringify(next) !== JSON.stringify(this.preferences)) {
      this.preferences = next; this.topbar?.render(); this.apply();
      this.tree?.configureSingleSection(false);
      this.tree?.configureFocus(false);
      this.controller?.configure(false, next.coloredTree);
      this.counts?.configure(next.notebookCounts);
    }
    await this.controller?.refresh();
    await Promise.all([this.reader?.onDataChanged(),this.rss?.onDataChanged()]);
  }
  onunload(): void {
    if (this.disposed) return;
    window.removeEventListener('pagehide', this.onPageHide);
    this.disposed = true; this.migration.abort();
    this.rss?.onunload();this.reader?.onunload();
    this.unmount();this.toast?.dispose();this.toast=undefined;
    this.topbar?.dispose();this.topbar=undefined;
    if(this.previousPlugin===null)document.documentElement.removeAttribute('data-yzc-plugin');
    else document.documentElement.setAttribute('data-yzc-plugin',this.previousPlugin);
  }
  private onPageHide = (): void => this.onunload();
}
