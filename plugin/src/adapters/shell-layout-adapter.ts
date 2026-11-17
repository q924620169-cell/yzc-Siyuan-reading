/** Measure the host's actual split, including rail, resize and collapsed sidebar.
 * Only geometry belongs here; the theme owns both surface colors.
 */
export class ShellLayoutAdapter {
  private resize: ResizeObserver;
  private mutation: MutationObserver;
  private observed = new Set<Element>();
  private frame = 0;
  private previous: string;
  private previousHeight: string;
  private previousCollapsed: string | null;
  private previousLeading: string;
  private paneStyles = new Map<HTMLElement, Map<string,string>>();
  constructor(private root: Document = document) {
    this.previous = root.documentElement.style.getPropertyValue('--sv-sidebar-edge');
    this.previousHeight = root.documentElement.style.getPropertyValue('--sv-toolbar-height');
    this.previousCollapsed = root.documentElement.getAttribute('data-sv-sidebar-collapsed');
    this.previousLeading=root.documentElement.style.getPropertyValue('--sv-window-leading');
    this.resize = new ResizeObserver(() => this.update());
    this.mutation = new MutationObserver(() => {
      if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.connect(); this.update(); });
    });
    this.mutation.observe(root.body, {subtree:true, childList:true, attributes:true, attributeFilter:['class','style']});
    this.connect(); this.update();
  }
  private connect(): void {
    const targets = new Set(this.root.querySelectorAll('#toolbar, #layouts, #dockLeft, #status, .layout__dockl, .layout__center, .protyle, .protyle-wysiwyg'));
    for (const el of this.observed) if (!targets.has(el)) { this.resize.unobserve(el); this.observed.delete(el); }
    for (const el of targets) if (!this.observed.has(el)) { this.resize.observe(el); this.observed.add(el); }
  }
  private update(): void {
    const center = this.root.querySelector('.layout__center');
    if (!center) return;
    const edge = Math.max(0, center.getBoundingClientRect().left);
    const railEdge = this.root.querySelector('#dockLeft')?.getBoundingClientRect().right ?? 0;
    const collapsed = String(edge <= railEdge + 1);
    if (this.root.documentElement.getAttribute('data-sv-sidebar-collapsed') !== collapsed)
      this.root.documentElement.setAttribute('data-sv-sidebar-collapsed', collapsed);
    const value = `${edge}px`;
    const before=this.root.querySelector('.yzc-windows')?.previousElementSibling;
    const beforeEdge=before?before.getBoundingClientRect().right+parseFloat(getComputedStyle(before).marginRight||'0'):edge;
    const leading=`${Math.max(0,edge-beforeEdge)}px`;
    if(this.root.documentElement.style.getPropertyValue('--sv-window-leading')!==leading)this.root.documentElement.style.setProperty('--sv-window-leading',leading);
    if (this.root.documentElement.style.getPropertyValue('--sv-sidebar-edge') !== value) this.root.documentElement.style.setProperty('--sv-sidebar-edge', value);
    const height = this.root.querySelector('#toolbar')?.getBoundingClientRect().height;
    if (height && this.root.documentElement.style.getPropertyValue('--sv-toolbar-height') !== `${height}px`) this.root.documentElement.style.setProperty('--sv-toolbar-height',`${height}px`);
    for(const [pane,previous] of this.paneStyles)if(!pane.isConnected){this.restorePane(pane,previous);this.paneStyles.delete(pane);}
    for(const pane of this.root.querySelectorAll<HTMLElement>('.protyle')) {
      const rect=pane.getBoundingClientRect(),content=pane.querySelector('.protyle-wysiwyg');
      const contentRect=content?.getBoundingClientRect();
      const padding=content?parseFloat(this.root.defaultView!.getComputedStyle(content).paddingRight)||0:0;
      const available=contentRect?Math.max(0,rect.right-contentRect.right+padding):52;
      const gutter=pane.classList.contains('yzc-has-outline')?Math.max(0,52-available):0;
      const status=this.root.querySelector('#status')?.getBoundingClientRect();
      const bottom=status && rect.bottom>status.top?Math.min(status.height,rect.bottom-status.top)+4:0;
      let previous=this.paneStyles.get(pane);
      if(!previous){previous=new Map();this.paneStyles.set(pane,previous);}
      for(const [key,value] of [['--yzc-editor-width',`${rect.width||0}px`],['--yzc-right-utility-gutter',`${gutter}px`],['--yzc-bottom-safe-area',`${bottom}px`]]) {
        if(!previous.has(key))previous.set(key,pane.style.getPropertyValue(key));
        if(pane.style.getPropertyValue(key)!==value)pane.style.setProperty(key,value);
      }
    }
  }
  private restorePane(pane:HTMLElement,previous:Map<string,string>):void {
    for(const [key,value] of previous)if(value)pane.style.setProperty(key,value);else pane.style.removeProperty(key);
  }
  dispose(): void {
    this.paneStyles.forEach((previous,pane)=>this.restorePane(pane,previous));this.paneStyles.clear();
    if(this.previousLeading)this.root.documentElement.style.setProperty('--sv-window-leading',this.previousLeading);
    else this.root.documentElement.style.removeProperty('--sv-window-leading');
    this.resize.disconnect(); this.mutation.disconnect(); cancelAnimationFrame(this.frame);
    if (this.previous) this.root.documentElement.style.setProperty('--sv-sidebar-edge',this.previous);
    else this.root.documentElement.style.removeProperty('--sv-sidebar-edge');
    if (this.previousHeight) this.root.documentElement.style.setProperty('--sv-toolbar-height',this.previousHeight);
    else this.root.documentElement.style.removeProperty('--sv-toolbar-height');
    if (this.previousCollapsed === null) this.root.documentElement.removeAttribute('data-sv-sidebar-collapsed');
    else this.root.documentElement.setAttribute('data-sv-sidebar-collapsed', this.previousCollapsed);
  }
}
