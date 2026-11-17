/** The host exposes notification preference "workspaceNotSSD", but changing it
 * would persist a global user preference beyond plugin unload. Snackbar markup
 * has only per-message IDs, so match exactly the host's localized kernel 278
 * text and remove that one toast before paint. Other messages stay untouched. */
export class SsdToastAdapter {
  private observer: MutationObserver;
  private messages: Set<string>;
  constructor(private doc:Document=document,localized?:string) {
    this.messages=new Set([
      '工作空间未放置在固态硬盘上，这会导致显著的性能下降，建议将工作空间放置在固态硬盘上使用',
      'The workspace is not located on a solid-state drive (SSD), which can cause significant performance degradation, it is recommended to place the workspace on an SSD',
      ...(localized?[localized]:[]),
    ]);
    this.observer=new doc.defaultView!.MutationObserver(()=>this.filter());
    this.observer.observe(doc.body,{subtree:true,childList:true,characterData:true});
    this.filter();
  }
  private filter():void {
    for(const content of this.doc.querySelectorAll<HTMLElement>('.b3-snackbar__content')) {
      const text=(content.textContent??'').trim().replace(/\s+v\d+\.\d+\.\d+(?:[-.\w]*)?$/,'');
      if(this.messages.has(text))content.closest('.b3-snackbar')?.remove();
    }
  }
  dispose():void {this.observer.disconnect();}
}
