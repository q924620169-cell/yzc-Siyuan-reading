export interface WindowDocument { id: string; title: string }
export interface WindowSlot { key: string; document?: WindowDocument; tool?: {id:string;title:string} }
export interface WindowState { version: 1; active: string; slots: WindowSlot[]; recent: WindowDocument[]; documentActive?:string }

/** Browsing changes a slot's document. Only add() creates a slot. */
export class WindowModel {
  readonly state: WindowState;
  constructor(raw: unknown, current?: WindowDocument) {
    const data = raw as Partial<WindowState> | null;
    const validDoc = (d: WindowDocument | undefined): d is WindowDocument => !!d && typeof d.id === 'string' && typeof d.title === 'string';
    const clean = (d: WindowDocument): WindowDocument => ({id:d.id,title:d.title});
    const slots:WindowSlot[] = Array.isArray(data?.slots) ? data.slots.filter(s => typeof s?.key === 'string').map(s => ({
      key:s.key,
      document:!s.tool && validDoc(s.document) ? clean(s.document) : undefined,
      ...(s.tool && typeof s.tool.id==='string' && typeof s.tool.title==='string'?{tool:{id:s.tool.id,title:s.tool.title}}:{}),
    })) : [];
    this.state = {version:1,slots:slots.length ? slots : [{key:'initial',document:current && clean(current)}],active:'',recent:Array.isArray(data?.recent) ? data.recent.filter(validDoc).map(clean).slice(0,100) : []};
    this.state.active = slots.some(s => s.key === data?.active) ? data!.active! : this.state.slots[0].key;
    if(slots.some(s=>s.key===data?.documentActive&&!s.tool))this.state.documentActive=data!.documentActive;
  }
  get active(): WindowSlot { return this.state.slots.find(s => s.key === this.state.active)!; }
  visit(doc: WindowDocument): void {
    // A host document navigation must never overwrite a registered tool slot.
    if(this.active.tool){
      const slot=this.state.slots.find(s=>!s.tool);
      if(slot)this.state.active=slot.key;else this.add('document-'+Date.now());
    }
    this.active.document = {id:doc.id,title:doc.title}; this.remember(doc);
  }
  remember(doc: WindowDocument): void {
    this.state.recent = [{id:doc.id,title:doc.title},...this.state.recent.filter(d => d.id !== doc.id)].slice(0,100);
  }
  add(key: string): void { this.state.slots.push({key}); this.state.active = key; }
  openTool(id:string,title:string):void {
    let slot=this.state.slots.find(s=>s.tool?.id===id);
    if(!slot){slot={key:`tool:${id}`,document:undefined,tool:{id,title}};this.state.slots.unshift(slot);}
    this.state.active=slot.key;
  }
  select(key: string): void { if (this.state.slots.some(s => s.key === key)) this.state.active = key; }
  close(key: string): void {
    if (this.state.slots.length === 1) {
      if(this.active.tool){this.state.slots=[{key:'initial'}];this.state.active='initial';}
      return;
    }
    const index = this.state.slots.findIndex(s => s.key === key);
    if (index < 0) return;
    this.state.slots.splice(index,1);
    if (this.state.active === key) this.state.active = this.state.slots[Math.min(index,this.state.slots.length-1)].key;
  }
  move(key: string, before: string | null): void {
    if (key === before) return;
    const from = this.state.slots.findIndex(s => s.key === key), to = before===null?this.state.slots.length:this.state.slots.findIndex(s => s.key === before);
    if (from < 0 || to < 0) return;
    const [slot] = this.state.slots.splice(from,1);
    const destination=before===null?this.state.slots.length:this.state.slots.findIndex(s => s.key === before);
    this.state.slots.splice(destination,0,slot);
  }
}
