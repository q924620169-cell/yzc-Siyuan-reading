import type { Plugin } from 'siyuan';
import { kernel, DocumentApi } from './document-attribute-adapter';
import { initialStatus, isStatus, STATUS_ATTRIBUTE, INL_STATUSES, type InlStatus } from '../inl/inl-status';
import { decodeCreation } from './host-events-adapter';
import {notebookId} from './native-tree-dom';
import type {NavigationPreferences} from '../navigation-order';
import {reorderable} from './navigation-reorder';
import {NavigationMotion} from './navigation-motion';
import {FilteredNativeTree} from './filtered-native-tree';
import {NavigationContentMotion} from './navigation-content-motion';
import {NativeTreeExpansion} from './native-tree-expansion';
import {NativeTreeActions} from './native-tree-actions';

interface Doc {id:string;box:string;path:string;content:string;tag:string;ial:string}
interface StatusMenu {addItem(item:{label:string;submenu:{label:string;icon?:string;click():void}[]}):unknown}
const quote=(s:string)=>"'"+s.replace(/'/g,"''")+"'";
const KEY='document-navigation.json';

/** One native tree, filtered by a single root-block status. Content tags stay independent. */
export class DocumentNavigation {
  async refreshImported(id:string):Promise<void> {
    await this.queue;
    if(this.disposed)throw Error('文档导航已停用');
    this.queue=this.queue.then(()=>this.scan([id]));
    await this.queue;
  }
  private docs=new Map<string,Doc>();
  private categories=new Map<string,InlStatus>();
  private navs=new Set<HTMLElement>();
  private observer:MutationObserver;
  private selected:InlStatus='now';
  private homeSelected=false;
  private defaultStatus:InlStatus='inbox';
  private creationIntent?:{notebook:string;parentId?:string;status:InlStatus;expires:number};
  private menuContext?:{notebook:string;parentId?:string;siblingParentId?:string;notebookRoot?:boolean};
  private homeId='';
  private homeTask?:Promise<string>;
  private disposed=false;
  private queue:Promise<void>=Promise.resolve();
  private migration:Record<string,Record<string,string>>={};
  private state:Record<string,unknown>={};
  private timer?:ReturnType<typeof setTimeout>;
  private dirty=new Set<string>();
  private rescan=false;
  private loaded=false;
  private offOrder?:()=>void;
  private motion:NavigationMotion;
  private selectionRevision=0;
  private persisted='';
  private nativeTree:FilteredNativeTree;
  private contentMotion:NavigationContentMotion;
  private reorderOffs=new Map<HTMLElement,(()=>void)[]>();
  private expansion:NativeTreeExpansion;
  private treeActions=new NativeTreeActions();
  constructor(private plugin:Plugin,private activate:()=>void,private report:(error:unknown)=>void,private doc:Document=document,private preferences?:NavigationPreferences) {
    this.motion=new NavigationMotion(doc);
    this.nativeTree=new FilteredNativeTree(doc);
    this.contentMotion=new NavigationContentMotion(doc);
    this.expansion=new NativeTreeExpansion(doc,state=>{this.state.nowExpansion=state;if(this.loaded&&!this.disposed)this.queue=this.queue.then(async()=>{await this.save();}).catch(this.report);});
    this.observer=new doc.defaultView!.MutationObserver(records=>{
      if(records.some(record=>{
        const target=record.target.nodeType===1?record.target as Element:record.target.parentElement;
        return !!target?.closest('.sy__file')||[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&((node as Element).matches('.sy__file')||!!(node as Element).querySelector('.sy__file')));
      }))this.paint();
    });
    this.observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-expanded','aria-busy']});
    plugin.eventBus.on('ws-main',this.onEvent);
    plugin.eventBus.on('open-menu-doctree',this.onTreeMenu);
    plugin.eventBus.on('click-editortitleicon',this.onTitleMenu);
    doc.addEventListener('click',this.captureCreation,true);
    doc.addEventListener('keydown',this.cancelCreation,true);
    doc.addEventListener('yzc-inl:document-space',this.onDocumentSpace);
    this.offOrder=preferences?.subscribe(()=>this.paint());
    this.paint();
    this.queue=this.load().catch(report);
  }
  private async load():Promise<void> {
    this.state=await this.plugin.loadData(KEY)||{};
    this.persisted=JSON.stringify(this.state);
    this.expansion.load(this.state.nowExpansion);
    this.homeId=typeof this.state.homeId==='string'?this.state.homeId:'';
    this.defaultStatus=isStatus(this.state.defaultStatus)?this.state.defaultStatus:'inbox';
    this.migration=await this.plugin.loadData('inl-status-backup.json')||{};
    if(!await this.plugin.loadData('navigation-legacy-backup.json')) {
      await this.plugin.saveData('navigation-legacy-backup.json',{version:1,settings:await this.plugin.loadData('settings.json'),notebooks:await this.plugin.loadData('inl-notebooks.json'),windows:await this.plugin.loadData('windows.json')});
    }
    await this.scan();this.loaded=true;this.paint();this.expansion.enter(this.selected);
  }
  private async scan(ids?:string[]):Promise<void> {
    if(this.disposed)return;
    // Explicit LIMIT avoids the user's search-result limit. One metadata scan at
    // startup/structural changes; ordinary attribute changes query affected roots.
    let offset=0;
    if(!ids){this.docs.clear();this.categories.clear();}
    // A new document can exist before the SQL index catches up. Incremental
    // queries must not discard the metadata supplied by its native create event.
    const notebooks=await this.plugin.loadData('inl-notebooks.json')||{};
    do {
      const batch=await kernel<Doc[]>('/api/query/sql',{stmt:`SELECT id,box,path,content,tag,ial FROM blocks WHERE type='d' ${ids?`AND id IN (${ids.map(quote).join(',')})`:''} ORDER BY id LIMIT 1000 OFFSET ${offset}`});
      for(const item of batch) {
        if(this.disposed)return;
        const attrs=await kernel<Record<string,string>>('/api/attr/getBlockAttrs',{id:item.id});
        const status=initialStatus(attrs,item.path,item.box,notebooks,this.defaultStatus);
        await this.writeStatus(item.id,status,attrs);
        this.docs.set(item.id,item);this.categories.set(item.id,status);
      }
      if(ids || batch.length<1000)break;
      offset+=batch.length;
    }while(!this.disposed);
    this.paint();
  }
  private save():Promise<unknown> {
    this.state={...this.state,homeId:this.homeId,selected:this.selected,defaultStatus:this.defaultStatus};const snapshot=this.state,serialized=JSON.stringify(snapshot);
    if(serialized===this.persisted)return Promise.resolve();
    return this.plugin.saveData(KEY,snapshot).then(()=>{this.persisted=serialized;});
  }
  private async home():Promise<string> {
    if(this.homeTask)return this.homeTask;
    this.homeTask=(async()=>{
      if(this.homeId) {
        // Verify directly: the SQL index can lag behind a just-created document.
        const existing=await kernel<Record<string,string>>('/api/attr/getBlockAttrs',{id:this.homeId});
        if(existing.id===this.homeId)return this.homeId;
        throw Error('关联的主页暂时不可访问，已保留文档 ID，请恢复原文档后重试。');
      }
      const {notebooks}=await kernel<{notebooks:{id:string;closed:boolean}[]}>('/api/notebook/lsNotebooks',{});
      const notebook=notebooks.find(n=>!n.closed);if(!notebook)throw Error('请先打开一个笔记本，再建立主页。');
      // Persist creation intent before the API. The stable path is idempotent if
      // the frontend closes between creation and saving the returned ID.
      const location=(this.state.homeLocation as {notebook:string;path:string})||{notebook:notebook.id,path:'/主页'};
      this.state.homeLocation=location;await this.save();
      if(this.disposed)throw Error('导航已停用');
      const previous=await kernel<string[]>('/api/filetree/getIDsByHPath',location);
      this.homeId=previous[0]||await kernel<string>('/api/filetree/createDocWithMd',{...location,markdown:''});
      await this.save();return this.homeId;
    })().finally(()=>{this.homeTask=undefined;});return this.homeTask;
  }
  private select(selected:InlStatus|'home',activate=true):void {
    if(activate)this.activate();
    const changed=this.homeSelected!==(selected==='home')||(selected!=='home'&&this.selected!==selected);
    const foldView=selected!=='home'&&(selected!=='now'||this.selected!=='now');
    const order=['home','now','library','inbox'],direction=order.indexOf(selected)>=order.indexOf(this.homeSelected?'home':this.selected)?1:-1;
    if(selected!=='home'&&selected!=='now'&&this.selected==='now')this.expansion.captureNow();
    if(foldView)this.expansion.prepare(selected as InlStatus);
    const revision=++this.selectionRevision;
    this.homeSelected=selected==='home';if(selected!=='home')this.selected=selected;
    this.paint();if(foldView)this.expansion.enter(selected as InlStatus);
    if(changed&&this.loaded&&activate)for(const list of this.doc.querySelectorAll<HTMLElement>('.sy__file .file-tree__items'))this.contentMotion.reveal(list,direction);
    this.queue=this.queue.then(async()=>{
      if(this.disposed)return;
      if(selected==='home'&&revision===this.selectionRevision) {const id=await this.home();if(!this.disposed&&revision===this.selectionRevision)new DocumentApi(this.plugin).open(id);}
      await this.save();
    }).catch(this.report);
  }
  private paint():void {
    if(this.disposed)return;
    for(const nav of this.navs)if(!nav.isConnected){this.reorderOffs.get(nav)?.forEach(off=>off());this.reorderOffs.delete(nav);this.navs.delete(nav);}
    for(const tree of this.doc.querySelectorAll<HTMLElement>('.sy__file')) {
      let nav=tree.querySelector<HTMLElement>(':scope>.yzc-document-nav');
      if(!nav) {
        nav=this.doc.createElement('div');nav.className='yzc-document-nav';
        const off:(()=>void)[]=[];this.reorderOffs.set(nav,off);
        const shortcuts=this.doc.createElement('div');shortcuts.className='yzc-document-shortcuts';nav.append(shortcuts);
        for(const [id,label,icon]of [['home','主页','home'],['library','资料库','library'],['inbox','未分类','inbox']] as const) {
          const button=this.doc.createElement('button');button.type='button';button.dataset.category=id;
          const image=this.doc.createElement('span');image.className='yzc-shortcut-icon';image.style.setProperty('--yzc-icon',`url('/plugins/yzc-Siyuan-reading/assets/nav-${icon}.svg')`);image.setAttribute('aria-hidden','true');
          button.append(image,this.doc.createTextNode(label));button.onclick=()=>this.select(id);shortcuts.append(button);
          if(this.preferences)off.push(reorderable(button,id,'shortcuts',this.preferences));
        }
        const group=this.doc.createElement('div');group.className='yzc-document-tree-head';
        const heading=this.doc.createElement('button');heading.type='button';heading.className='yzc-document-tree-title';heading.innerHTML='<svg class="yzc-document-return-arrow" aria-hidden="true"><use href="#iconBack"></use></svg><span>我的文档</span>';heading.dataset.category='now';heading.title='我的文档（Now）';heading.setAttribute('aria-label','我的文档（Now）');heading.onclick=()=>this.select('now');group.append(heading);nav.append(group);
        tree.prepend(nav);this.navs.add(nav);
      }
      this.treeActions.mount(tree,nav.querySelector<HTMLElement>('.yzc-document-tree-head')!);
      const shortcuts=nav.querySelector('.yzc-document-shortcuts')!;
      const order=this.preferences?.order('shortcuts')??['home','library','inbox'];
      this.motion.reconcile(shortcuts as HTMLElement,order.map(id=>shortcuts.querySelector<HTMLButtonElement>(`[data-category="${id}"]`)!));
      const heading=nav.querySelector<HTMLButtonElement>('.yzc-document-tree-title')!,filtered=this.selected!=='now';
      if(heading.hasAttribute('data-filtered')!==filtered)heading.toggleAttribute('data-filtered',filtered);
      for(const button of nav.querySelectorAll('button')) {
        const value=(button.dataset.category==='home'?this.homeSelected:!this.homeSelected&&button.dataset.category===this.selected)?'page':'false';
        if(button.getAttribute('aria-current')!==value)button.setAttribute('aria-current',value);
      }
    }
    if(!this.loaded)return;
    const allowed=new Set<string>(),boxes=new Set<string>();
    for(const [id,item]of this.docs)if(this.categories.get(id)===this.selected) {
      boxes.add(item.box);for(const part of item.path.replace(/\.sy$/,'').split('/').filter(Boolean))allowed.add(part);
    }
    for(const row of this.doc.querySelectorAll<HTMLElement>('.sy__file li[data-type^=navigation-]')) {
      const notebook=row.dataset.treeKey?.split('/')[0].replace('notebook:','')||row.closest<HTMLElement>('ul[data-url]')?.dataset.url;
      const visible=row.dataset.type==='navigation-root'?boxes.has(notebook||''):allowed.has(row.dataset.nodeId||'');
      if(row.hasAttribute('data-yzc-class-hidden')===visible)row.toggleAttribute('data-yzc-class-hidden',!visible);
    }
    this.nativeTree.sync();
    this.expansion.sync(this.selected);
  }
  private async writeStatus(id:string,status:InlStatus,attrs:Record<string,string>):Promise<void> {
    if(this.disposed||attrs[STATUS_ATTRIBUTE]===status)return;
    if(!this.migration[id]) {
      this.migration[id]={...attrs};await this.plugin.saveData('inl-status-backup.json',this.migration);
    }
    if(!this.disposed)await kernel('/api/attr/setBlockAttrs',{id,attrs:{[STATUS_ATTRIBUTE]:status}});
  }
  private setStatus(ids:string[],status:InlStatus):void {
    this.queue=this.queue.then(async()=>{
      for(const id of ids) {
        if(this.disposed)return;
        const attrs=await kernel<Record<string,string>>('/api/attr/getBlockAttrs',{id});
        if(!this.docs.has(id)&&attrs.type!=='doc')continue;
        await this.writeStatus(id,status,attrs);this.categories.set(id,status);
      }
      this.paint();
    }).catch(this.report);
  }
  private statusMenu(menu:StatusMenu,ids:string[]):void {
    if(!ids.length)return;
    menu.addItem({label:'INL 状态',submenu:INL_STATUSES.map(status=>({
      label:{now:'Now',library:'Library',inbox:'Inbox'}[status],
      icon:ids.every(id=>this.categories.get(id)===status)?'iconCheck':undefined,
      click:()=>this.setStatus(ids,status),
    }))});
  }
  private onTreeMenu=(event:CustomEvent):void=>{
    const {menu,items,type,elements}=event.detail;
    if(type==='notebook'||type==='notebooks') {
      const row=elements?.[0] as HTMLElement|undefined;
      this.menuContext=row?{notebook:notebookId(row)||items?.[0]?.notebookId,notebookRoot:true}:undefined;
      return;
    }
    const ids:string[]=[...new Set<string>((items||[]).map((item:{id:string})=>item.id).filter(Boolean))];
    this.statusMenu(menu,ids);
    const row=elements?.[0] as HTMLElement|undefined;
    const parts=(this.docs.get(row?.dataset.nodeId||'')?.path||items?.[0]?.path||'').replace(/\.sy$/,'').split('/').filter(Boolean);
    this.menuContext=row?{notebook:notebookId(row)||items?.[0]?.notebookId,parentId:row.dataset.nodeId,siblingParentId:parts.length>1?parts.at(-2):undefined}:undefined;
  };
  private onTitleMenu=(event:CustomEvent):void=>{
    this.menuContext=undefined;
    const id=event.detail.protyle?.block?.rootID;if(id)this.statusMenu(event.detail.menu,[id]);
  };
  private onDocumentSpace=():void=>this.select('now',false);
  private captureCreation=(event:MouseEvent):void=>{
    const target=event.target instanceof this.doc.defaultView!.Element?event.target as Element:undefined;
    const action=target?.closest('[data-type="new"]');
    const row=action?.closest<HTMLElement>('.sy__file li[data-type^="navigation-"]');
    let context:{notebook:string;parentId?:string}|undefined=row?{notebook:notebookId(row)||'',parentId:row.dataset.type==='navigation-file'?row.dataset.nodeId:undefined}:undefined;
    // Native context-menu creation is recognized by its own semantic label,
    // never by the order of the menu's children.
    const item=target?.closest('.b3-menu__item');
    if(!context&&this.menuContext&&item?.closest('#commonMenu')) {
      const label=item.querySelector('.b3-menu__label')?.textContent?.trim()||item.textContent?.trim()||'';
      if(/新建子文档|New subdocument/i.test(label))context=this.menuContext;
      else if(/在[上下]方新建文档|New document (above|below)/i.test(label))context={notebook:this.menuContext.notebook,parentId:this.menuContext.siblingParentId};
      else if(this.menuContext.notebookRoot&&/^(新建文档|New document)$/i.test(label))context={notebook:this.menuContext.notebook};
    }
    if(context?.notebook)this.creationIntent={...context,status:this.selected,expires:Date.now()+5000};
  };
  private cancelCreation=(event:KeyboardEvent):void=>{if(event.key==='Escape'){this.creationIntent=undefined;this.menuContext=undefined;}};
  private onEvent=(event:CustomEvent):void=>{
    if(this.disposed)return;
    const created=decodeCreation(event.detail);
    if(created) {
      const intent=this.creationIntent;
      const fromTree=!!intent&&intent.expires>=Date.now()&&intent.notebook===created.notebook&&intent.parentId===created.parentId;
      const status=fromTree?intent!.status:this.defaultStatus;
      this.creationIntent=undefined;
      this.menuContext=undefined;
      this.queue=this.queue.then(async()=>{
        if(this.disposed)return;
        const attrs=await kernel<Record<string,string>>('/api/attr/getBlockAttrs',{id:created.id});
        if(fromTree||!isStatus(attrs[STATUS_ATTRIBUTE]))await this.writeStatus(created.id,status,attrs);
        const actual=fromTree||!isStatus(attrs[STATUS_ATTRIBUTE])?status:attrs[STATUS_ATTRIBUTE] as InlStatus;
        const path=(event.detail.data as {path:string}).path;
        this.docs.set(created.id,{id:created.id,box:created.notebook,path,content:attrs.title||'未命名文档',tag:'',ial:''});
        this.categories.set(created.id,actual);this.paint();
      }).catch(this.report);return;
    }
    const detail=event.detail;
    if(!['setBlockAttrs','transactions','removeDoc','moveDocs','mount','closeBox','refresh','syncMergeResult','rename'].includes(detail.cmd))return;
    const ids=new Set<string>();
    const walk=(value:unknown):void=>{
      if(!value||typeof value!=='object')return;
      for(const [key,v]of Object.entries(value))if(['id','rootID','rootId'].includes(key)&&typeof v==='string'&&/^\d{14}-[a-z0-9]{7}$/.test(v))ids.add(v);else if(typeof v==='object')walk(v);
    };walk(detail.data);
    if(['moveDocs','mount','closeBox','refresh','syncMergeResult','removeDoc'].includes(detail.cmd))this.rescan=true;
    else for(const id of ids)this.dirty.add(id);
    clearTimeout(this.timer);this.timer=setTimeout(()=>{
      const affected=[...this.dirty];this.dirty.clear();const all=this.rescan;this.rescan=false;
      if(all||affected.length)this.queue=this.queue.then(()=>this.scan(all?undefined:affected)).catch(this.report);
    },180);
  };
  dispose():void {
    this.disposed=true;this.offOrder?.();this.reorderOffs.forEach(offs=>offs.forEach(off=>off()));this.reorderOffs.clear();this.motion.dispose();this.nativeTree.dispose();this.contentMotion.dispose();this.expansion.dispose();
    clearTimeout(this.timer);this.observer.disconnect();this.plugin.eventBus.off('ws-main',this.onEvent);
    this.plugin.eventBus.off('open-menu-doctree',this.onTreeMenu);this.plugin.eventBus.off('click-editortitleicon',this.onTitleMenu);
    this.doc.removeEventListener('click',this.captureCreation,true);this.doc.removeEventListener('keydown',this.cancelCreation,true);this.doc.removeEventListener('yzc-inl:document-space',this.onDocumentSpace);
    this.treeActions.dispose();for(const nav of this.navs)nav.remove();this.navs.clear();
    this.doc.querySelectorAll('[data-yzc-class-hidden]').forEach(row=>row.removeAttribute('data-yzc-class-hidden'));
  }
}
