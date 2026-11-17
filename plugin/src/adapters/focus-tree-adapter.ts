import { TREE, ITEMS, ROOT, ROW, canExpand, flatList, flatRows, nodeId, occurrence, parentOccurrence, scopeKey } from './native-tree-dom';

interface Place {key:string;id?:string;title:string}
export interface FocusBinding {group:{key:string};owner:HTMLElement;list?:HTMLElement}
const rootPlace=():Place=>({key:'root',title:'全部文档'});

/** Presentation only. Uses the same native nodes and projection as Complete Tree. */
export class FocusTreeAdapter {
  enabled=false;
  private path:Place[]=[rootPlace()];
  private headers=new Map<Element,{back:HTMLButtonElement;title:HTMLElement;crumb:HTMLElement}>();
  constructor(private doc:Document,private navigate:(closedScope:string)=>void) {}
  get key():string {return this.path.at(-1)!.key;}
  get ownerId():string|undefined {return this.path.at(-1)!.id;}
  private row(id:string):HTMLElement|undefined {
    return [...this.doc.querySelectorAll<HTMLElement>(`${TREE} ${ROOT}, ${TREE} ${ROW}`)].find(row=>nodeId(row)===id);
  }
  private place(row:HTMLElement):Place {
    return {key:scopeKey(row)!,id:nodeId(row),title:row.querySelector('.b3-list-item__text')?.textContent?.trim()||'未命名文档'};
  }
  private parent(row:HTMLElement):HTMLElement|undefined {
    const key=parentOccurrence(row);
    const items=row.closest(ITEMS);
    const list=items && flatList(items);
    if (key && list) return flatRows(list).find(candidate=>occurrence(candidate)===key);
    const owner=row.parentElement?.previousElementSibling;
    return owner instanceof this.doc.defaultView!.HTMLElement && owner.matches(`${ROOT}, ${ROW}`) ? owner : undefined;
  }
  enter(row:HTMLElement):void {
    const places:Place[]=[];
    for(let node:HTMLElement|undefined=row;node && scopeKey(node);node=this.parent(node))places.unshift(this.place(node));
    this.path=[rootPlace(),...places];
  }
  configure(enabled:boolean,selection?:string|null):void {
    if(enabled===this.enabled)return;
    this.enabled=enabled;
    if(enabled && selection) {
      const row=this.row(selection);
      if(row) {
        const scope=canExpand(row) ? row : this.parent(row);
        if(scope)this.enter(scope);
      }
    }
    if(!enabled)this.cleanupView();
  }
  private cleanupView():void {
    for(const [tree,header] of this.headers) {tree.classList.remove('yzc-focus-tree');header.back.remove();header.title.remove();header.crumb.remove();}
    this.headers.clear();
    this.doc.querySelectorAll('.yzc-focus-path,.yzc-focus-current').forEach(el=>el.classList.remove('yzc-focus-path','yzc-focus-current'));
    this.doc.querySelectorAll('.yzc-focus-book').forEach(el=>el.remove());
  }
  present(bindings:readonly FocusBinding[]):void {
    if(!this.enabled)return;
    // Path changes and node replacement commit in the same pre-paint transaction.
    this.doc.querySelectorAll('.yzc-focus-path,.yzc-focus-current').forEach(el=>el.classList.remove('yzc-focus-path','yzc-focus-current'));
    for(const [tree,header] of this.headers)if(!tree.isConnected){header.back.remove();header.title.remove();header.crumb.remove();this.headers.delete(tree);}
    const selected=this.ownerId?this.row(this.ownerId):undefined;
    if(selected)this.enter(selected); // Native rename/ancestor changes update context.
    for(const tree of this.doc.querySelectorAll(TREE)) {
      const items=tree.querySelector<HTMLElement>('.file-tree__items');
      const icons=tree.querySelector('.block__icons');
      if(!items||!icons)continue;
      tree.classList.add('yzc-focus-tree');
      let header=this.headers.get(tree);
      if(!header) {
        const back=this.doc.createElement('button');back.type='button';back.className='yzc-focus-back';back.textContent='‹';back.setAttribute('aria-label','返回上一级');
        back.onclick=event=>{event.stopPropagation();if(this.path.length>1){const closed=this.path.pop()!;this.navigate(closed.key);}};
        const title=this.doc.createElement('span');title.className='yzc-focus-title';
        const crumb=this.doc.createElement('div');crumb.className='yzc-focus-crumb';
        icons.prepend(back,title);items.before(crumb);header={back,title,crumb};this.headers.set(tree,header);
      }
      if(header.back.parentElement!==icons || header.title.parentElement!==icons)icons.prepend(header.back,header.title);
      if(header.crumb.nextElementSibling!==items)items.before(header.crumb);
      header.back.disabled=this.path.length===1;
      header.title.textContent=this.path.at(-1)!.title;
      header.crumb.textContent=this.path.map(p=>p.title).join(' / ');header.crumb.title=header.crumb.textContent;
      items.classList.add('yzc-focus-path');
      if (flatList(items)) {
        items.classList.add('yzc-focus-current');
        continue; // Flat rows are already filtered by the document-tree adapter.
      }
      const binding=bindings.find(b=>b.group.key===this.key && tree.contains(b.owner));
      // A scope may be loading children: keep the same shell and show no wrong tree.
      const current=this.key==='root'?items:binding?.list;
      if(!current)continue;
      current.classList.add('yzc-focus-current');
      for(const row of current.querySelectorAll<HTMLElement>(':scope > li[data-type="navigation-file"]')) {
        if(Number(row.dataset.count)<=0)row.querySelector('.yzc-focus-book')?.remove();
        if(Number(row.dataset.count)>0 && !row.querySelector('.yzc-focus-book')) {
          const icon=this.doc.createElement('img');icon.className='yzc-focus-book';icon.alt='';icon.src='/plugins/yzc-Siyuan-reading/assets/yzc-book.svg';
          row.querySelector('.b3-list-item__text')?.before(icon);
        }
      }
      for(let node:HTMLElement|null=current;node&&items.contains(node);node=node.parentElement)node.classList.add('yzc-focus-path');
    }
  }
  dispose():void {this.cleanupView();this.enabled=false;}
}
