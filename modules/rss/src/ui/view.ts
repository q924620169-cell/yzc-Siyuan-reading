import {allFilter,filterArticles,sourceGroups,inGroup,sourceIdsFor,groupSelection,chineseDate,displayIdentity,type Article,type ArticleBody,type Filter} from '../model';
import {safeHtml} from '../content';
import type {Repository} from '../storage';
import type {RssService} from '../service';
import type {ImageCache} from '../cache';
import type {Inbox} from '../inbox';
import type {InlBridge} from '../bridge';
import {el,button,iconButton,hostIconButton,articleBack,checkbox,action,input,rssIcon} from './dom';
import {renderSettings} from './settings';
import {readerHtml} from './reader-format';
import {HostTypography} from './host-typography';
import {translatedContent,type TranslationService,type TranslationResult} from '../translation';
interface Options {repo:Repository;service:RssService;cache:ImageCache;inbox:Inbox;translation?:TranslationService;bridge:()=>InlBridge|undefined;message:(text:string,error?:boolean)=>void;reschedule:()=>void}
interface Position {top:number;anchor?:string;offset?:number}
interface ReadingState {list:Position;page:number;article?:string;reader:number}
type Card=HTMLElement & {loadPreview?:()=>void;imageToken?:number;wanted?:string;started?:boolean;actionKey?:string};
export class RssView {
  private typography=new HostTypography();
  readonly sidebar=el('aside','rss-sidebar');
  private content?:HTMLElement;private scroll?:HTMLElement;private filter=allFilter();private draft?:Filter;
  private collapsed=new Set<string>();private beforeCollapsed?:Set<string>;
  private screen:'list'|'reader'='list';private selected?:Article;private body?:ArticleBody;
  private listScroll=0;private page=0;private generation=0;private unsubscribe:()=>void;private signature='';
  private history=new Map<string,ReadingState>();private listPosition:Position={top:0};private readerScroll=0;
  private cancelRestore?:()=>void;private imageObserver?:IntersectionObserver;private closed=false;
  private sidebarSignature='';private articlePositions=new Map<string,number>();
  private cardNodes=new Map<string,Card>();private closeSettings?:()=>void;private settingsRequested=false;
  private closeTags?:()=>void;
  private reading?:TranslationResult;private bilingual=false;private translating=false;private translationError='';private translationToken=0;
  private reloads=new Map<string,Promise<void>>();private activityTimer?:ReturnType<typeof setTimeout>;private activityKey='';private activityStarted=0;private listActive=false;
  private unsubscribeRefresh=()=>{};private unsubscribeTranslation=()=>{};private renderedParts=new Map<string,string>();private focusFrame=0;
  constructor(private options:Options){
    this.unsubscribe=options.repo.subscribe(()=>{
      const s=options.repo.state,signature=JSON.stringify([this.navigationSignature(),s.articles.map(a=>[a.id,a.title,a.summary,a.author,a.published,a.tags,a.cover,a.previewCover,a.later]),s.imports,s.history.map(h=>[h.articleId,h.openedAt])]);if(signature===this.signature)return;
      this.signature=signature;if(this.navigationSignature()!==this.sidebarSignature)this.renderSidebar();
      if(this.screen==='list')this.renderList(true);
      else if(this.selected&&this.body){const a=this.scroll?.querySelector('.rss-reader-info .rss-article-actions');a?.replaceWith(this.actions(this.selected,true));this.updateReaderTags();}
    });this.unsubscribeTranslation=options.translation?.subscribe(id=>{const article=this.live(id),node=this.cardNodes.get(id);if(article&&node)this.patchCard(node,article);if(this.selected?.id===id)this.updateReaderTitle();})??(()=>{});this.unsubscribeRefresh=options.service.subscribeRefresh(()=>this.updateActivity());this.renderSidebar();
  }
  attach(host:HTMLElement):void{
    this.imageObserver?.disconnect();this.imageObserver=undefined;this.content=undefined;host.replaceChildren();host.classList.add('rss-tab');
    const scroll=el('div','protyle-content rss-scroll');scroll.dataset.paddingMode='responsive';
    const content=el('main','protyle-wysiwyg rss-content');content.setAttribute('data-readonly','true');
    scroll.append(content);host.append(scroll);this.scroll=scroll;this.content=content;scroll.addEventListener('scroll',()=>{cancelAnimationFrame(this.focusFrame);this.focusFrame=requestAnimationFrame(()=>this.focusReading());},{passive:true});this.syncHost();
    if(this.screen==='reader'&&this.selected&&this.body)this.renderReader();else this.renderList();
    if(this.settingsRequested)this.settings();
  }
  detach():void{this.translationToken++;this.options.translation?.releaseReader(this.selected?.id);cancelAnimationFrame(this.focusFrame);this.closeTags?.();this.closeSettings?.();this.remember();this.cancelRestore?.();this.imageObserver?.disconnect();this.imageObserver=undefined;this.content=undefined;this.scroll=undefined;++this.generation;}
  syncHost():void{
    if(!this.scroll)return;const config=window.siyuan?.config?.editor;
    if(config?.fullWidth)this.scroll.dataset.fullwidth='true';else delete this.scroll.dataset.fullwidth;
    const rail=document.querySelector('#dockLeft');
    const accent=rail?getComputedStyle(rail).getPropertyValue('--b3-theme-primary').trim():'';
    for(const host of [this.sidebar,this.content?.closest<HTMLElement>('.rss-tab'),document.querySelector<HTMLElement>('.rss-settings-overlay')])if(host)host.style.setProperty('--rss-accent',accent||'var(--b3-theme-primary, #3575f0)');
    this.syncTypography();
  }
  private syncTypography():void{this.typography.sync(this.content?.querySelector<HTMLElement>('.rss-reader-body')??undefined,this.content?.querySelector<HTMLElement>('.rss-reader-title h1'));}
  private report=(error:unknown):void=>{if(!this.closed)this.options.message(error instanceof Error?error.message:String(error),true);};
  /** Sidebar source icons stay optional so RSS can match the document panel's icon policy. */
  private treeIcons():boolean{try{return window.localStorage.getItem('rss-tree-icons')!=='off';}catch{return true;}}
  private setTreeIcons(value:boolean):void{try{window.localStorage.setItem('rss-tree-icons',value?'on':'off');}catch{}this.sidebarSignature='';this.renderSidebar();}
  private filterKey(filter=this.filter):string{return JSON.stringify([filter.mode,filter.value??'',[...filter.sourceIds].sort(),[...filter.tags].sort()]);}
  private position():Position{
    const top=this.scroll?.scrollTop??0,base=this.scroll?.getBoundingClientRect().top??0;
    const anchor=[...(this.content?.querySelectorAll<HTMLElement>('.rss-card')??[])].find(e=>e.getBoundingClientRect().bottom>base);
    return{top,anchor:anchor?.dataset.articleId,offset:anchor?anchor.getBoundingClientRect().top-base:undefined};
  }
  private remember():void{
    if(this.screen==='list'){this.listPosition=this.position();this.listScroll=this.listPosition.top;}
    if(this.screen==='reader'){this.readerScroll=this.scroll?.scrollTop??this.readerScroll;if(this.selected){this.articlePositions.delete(this.selected.id);this.articlePositions.set(this.selected.id,this.readerScroll);if(this.articlePositions.size>32)this.articlePositions.delete(this.articlePositions.keys().next().value!);}}
    const key=this.filterKey();this.history.delete(key);this.history.set(key,{list:this.listPosition,page:this.page,article:this.screen==='reader'?this.selected?.id:undefined,reader:this.readerScroll});
    if(this.history.size>32)this.history.delete(this.history.keys().next().value!);
  }
  private restore(position:Position):void{
    this.cancelRestore?.();const scroll=this.scroll,content=this.content;if(!scroll||!content)return;
    const apply=()=>{const anchor=position.anchor?[...content.querySelectorAll<HTMLElement>('.rss-card')].find(e=>e.dataset.articleId===position.anchor):undefined;
      scroll.scrollTop=anchor?scroll.scrollTop+anchor.getBoundingClientRect().top-scroll.getBoundingClientRect().top-(position.offset??0):position.top;};
    apply();const resize=new ResizeObserver(apply);resize.observe(content);
    const stop=()=>{resize.disconnect();clearTimeout(timer);for(const event of ['wheel','pointerdown','keydown'])scroll.removeEventListener(event,stop);};
    const timer=setTimeout(stop,1500);for(const event of ['wheel','pointerdown','keydown'])scroll.addEventListener(event,stop,{once:true});this.cancelRestore=stop;
  }
  private select(filter:Filter,keepSidebar=false,restoreReader=true,reload=true):void{
    this.options.translation?.releaseReader(this.selected?.id);this.remember();this.filter=filter;this.draft=undefined;this.screen='list';this.selected=undefined;this.body=undefined;
    const saved=this.history.get(this.filterKey());this.listPosition=saved?.list??{top:0};this.listScroll=this.listPosition.top;this.page=saved?.page??0;
    ++this.generation;if(!keepSidebar)this.renderSidebar();this.renderList();
    const article=restoreReader&&saved?.article?this.options.repo.state.articles.find(a=>a.id===saved.article):undefined;if(article)void this.read(article,saved!.reader);else if(reload)void this.reloadList().catch(this.report);
  }
  private navigate(filter:Filter,keepSidebar=false):void{this.select(filter,keepSidebar,false,false);void this.refresh().catch(this.report);}
  private navigationSignature():string{const s=this.options.repo.state;return JSON.stringify([s.sources.map(x=>[x.id,x.title,sourceGroups(x),x.tags,x.error]),s.groups,s.tags]);}
  private renderSidebar():void{
    this.sidebarSignature=this.navigationSignature();
    const s=this.options.repo.state,nav=this.sidebar,top=nav.scrollTop;nav.replaceChildren();
    const body=el('div','rss-nav-content'),browse=el('nav','rss-browse-nav');nav.append(body);body.append(browse);
    for(const [mode,label,asset] of [['all','全部文章','all-articles'],['later','稍后看','later-nav'],['history','观看历史','history']] as const){const b=button('',()=>this.navigate({...allFilter(),mode,tags:mode==='history'?[]:[...this.filter.tags]}),'rss-nav-item rss-browse-item'),slot=el('span','rss-nav-icon');slot.setAttribute('aria-hidden','true');slot.append(rssIcon(asset));b.append(slot,el('span','',label));b.setAttribute('aria-current',String(this.filter.mode===mode&&!this.draft));browse.append(b);}
    const sourcesHead=el('div','rss-nav-section');
    if(this.draft){sourcesHead.append(button('取消自选',()=>{this.draft=undefined;this.collapsed=this.beforeCollapsed??this.collapsed;this.beforeCollapsed=undefined;this.renderSidebar();},'rss-text-button'),button('完成筛选',()=>{const draft=this.draft!;this.beforeCollapsed=undefined;this.select(draft);},'rss-text-button'));body.append(sourcesHead,el('p','rss-filter-hint','勾选来源；分组箭头只控制展开或收起'));}
    else{sourcesHead.append(el('span','rss-nav-label','来源 / 作者'),button('自选',()=>{this.beforeCollapsed=new Set(this.collapsed);this.draft={mode:'custom',sourceIds:sourceIdsFor(this.filter,s.sources),tags:[...this.filter.tags]};this.renderSidebar();},'rss-text-button'));body.append(sourcesHead);}
    if(!s.sources.length)body.append(button('添加第一个订阅',()=>this.settings(),'rss-nav-item rss-muted'));
    for(const group of [...new Set([...s.groups,...s.sources.flatMap(x=>sourceGroups(x).length?sourceGroups(x):['未分组'])])]){
      const sources=s.sources.filter(x=>inGroup(x,group)),row=el('div','rss-group-row rss-tree-row'),children=el('div','rss-group-children');
      children.hidden=this.collapsed.has(group);children.dataset.group=group;
      const expanded=()=>!this.collapsed.has(group);
      const updateToggle=()=>{toggle.setAttribute('aria-expanded',String(expanded()));toggle.setAttribute('aria-label',`${expanded()?'收起':'展开'}分组 ${group}`);toggle.title=toggle.getAttribute('aria-label')!;};
      const expand=()=>{
        const opening=this.collapsed.has(group);
        if(opening){this.collapsed.delete(group);children.hidden=false;}else this.collapsed.add(group);
        const full=children.scrollHeight,reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false;
        children.getAnimations?.().forEach(a=>a.cancel());
        if(!reduced&&children.animate){const animation=children.animate([{height:opening?'0px':`${full}px`,opacity:opening?0:1},{height:opening?`${full}px`:'0px',opacity:opening?1:0}],{duration:170,easing:'cubic-bezier(.2,.7,.3,1)'});void animation.finished.then(()=>{children.hidden=!opening;},()=>{});}else children.hidden=!opening;
        updateToggle();
      };
      const toggle=button('',expand,'rss-group-toggle');toggle.append(rssIcon('chevron'));updateToggle();
      const groupButton=button('',()=>{
        if(this.draft){expand();return;}
        this.navigate({...allFilter(),mode:'group',value:group,tags:[...this.filter.tags]},true);
        this.sidebar.querySelectorAll('.rss-nav-item[aria-current=true]:not(.rss-tag)').forEach(b=>b.setAttribute('aria-current','false'));groupButton.setAttribute('aria-current','true');
      },'rss-nav-item rss-tree-group');
      const showIcons=this.treeIcons(),count=el('span','rss-tree-count',String(sources.length));count.setAttribute('aria-hidden','true');
      if(showIcons){const bookSlot=el('span','rss-tree-icon rss-tree-book');bookSlot.setAttribute('aria-hidden','true');bookSlot.append(rssIcon('book'));groupButton.append(bookSlot);}
      groupButton.append(el('span','rss-tree-label',group),count);groupButton.title=`筛选 ${group} · ${sources.length} 个来源`;
      groupButton.setAttribute('aria-current',String(!this.draft&&this.filter.mode==='group'&&this.filter.value===group));
      row.append(toggle,groupButton);
      if(this.draft){
        const selection=groupSelection(sources.map(x=>x.id),new Set(this.draft.sourceIds));const check=checkbox('',selection==='all',checked=>{
          const selected=new Set(this.draft!.sourceIds);sources.forEach(x=>checked?selected.add(x.id):selected.delete(x.id));this.draft!.sourceIds=[...selected];if(checked)this.collapsed.add(group);this.renderSidebar();
        },selection==='partial');check.querySelector('input')!.setAttribute('aria-label',group);row.prepend(check);
      }
      body.append(row,children);
      for(const source of sources){const child=el('div','rss-source-row');
        const documentSlot=showIcons?el('span','rss-tree-icon rss-tree-document'):undefined;if(documentSlot){documentSlot.setAttribute('aria-hidden','true');documentSlot.append(rssIcon('document'));}
        if(this.draft){const check=checkbox(source.title,this.draft.sourceIds.includes(source.id),checked=>{this.draft!.sourceIds=checked?[...new Set([...this.draft!.sourceIds,source.id])]:this.draft!.sourceIds.filter(id=>id!==source.id);if(groupSelection(sources.map(x=>x.id),new Set(this.draft!.sourceIds))==='all')this.collapsed.add(group);this.renderSidebar();});check.classList.add('rss-tree-source-check');if(documentSlot)check.querySelector('span')!.before(documentSlot);child.append(check);}
        else{const b=button('',()=>this.navigate({...allFilter(),mode:'source',value:source.id,tags:[...this.filter.tags]}),'rss-nav-item rss-tree-source');b.title=source.error?`${source.title} · 刷新失败：${source.error}`:source.title;b.setAttribute('aria-current',String(this.filter.mode==='source'&&this.filter.value===source.id));if(documentSlot)b.append(documentSlot);b.append(el('span','rss-tree-label',source.title));if(source.error)b.dataset.error='true';child.append(b);}children.append(child);
      }
    }
    body.append(el('div','rss-nav-section rss-nav-label','内容标签'));
    if(!s.tags.length)body.append(el('p','rss-filter-hint','添加来源标签或订阅分类后会出现在这里。'));
    const selectedTags=(this.draft??this.filter).tags,ordered=[...s.tags.filter(t=>selectedTags.includes(t)),...s.tags.filter(t=>!selectedTags.includes(t))];
    const tags=el('div','rss-tag-list');body.append(tags);
    for(const tag of ordered){const selected=selectedTags.includes(tag);
      const change=()=>{if(this.draft){this.draft.tags=selected?this.draft.tags.filter(t=>t!==tag):[...this.draft.tags,tag];this.renderSidebar();}else this.select({...this.filter,mode:this.filter.mode==='history'?'all':this.filter.mode,tags:selected?this.filter.tags.filter(t=>t!==tag):[...this.filter.tags,tag]});};
      const b=this.draft?checkbox(`# ${tag}`,selected,change):button(`# ${tag}`,change,'rss-nav-item');
      b.classList.add('rss-tag');b.setAttribute('aria-current',String(selected));if(selected){b.classList.add('rss-tag-selected');if(tag===ordered[0])b.classList.add('rss-tag-first');if(tag===ordered[selectedTags.filter(t=>s.tags.includes(t)).length-1])b.classList.add('rss-tag-last');}tags.append(b);
    }nav.scrollTop=top;
  }
  private heading():string{if(this.filter.mode==='history')return '观看历史';if(this.filter.mode==='all')return '全部文章';if(this.filter.mode==='later')return '稍后看';if(this.filter.mode==='group')return this.filter.value??'来源分组';if(this.filter.mode==='source')return this.options.repo.state.sources.find(s=>s.id===this.filter.value)?.title??'来源';return '文章';}
  private observer():IntersectionObserver{
    if(!this.imageObserver)this.imageObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){this.imageObserver?.unobserve(entry.target);(entry.target as Card).loadPreview?.();}},{root:this.scroll,rootMargin:'250px'});
    return this.imageObserver;
  }
  private renderList(preserve=false):void{
    this.closeTags?.();
    if(this.screen==='list'){this.scroll?.querySelector('.rss-reader-toolbar')?.remove();if(this.scroll)this.scroll.style.removeProperty('scroll-padding-top');}
    const host=this.content;if(!host||this.screen!=='list')return;const position=preserve?this.position():{...this.listPosition,top:this.listScroll};
    let cards=host.querySelector<HTMLElement>(':scope > .rss-feed');
    if(!cards){this.imageObserver?.disconnect();this.imageObserver=undefined;host.replaceChildren();const header=el('header','rss-feed-head');const title=el('h1','rss-page-title');title.tabIndex=0;title.title='刷新当前列表';title.addEventListener('click',()=>void this.refresh(false,true).catch(this.report));title.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.repeat){event.preventDefault();void this.refresh(false,true).catch(this.report);}});header.append(title,el('p','rss-muted'));const line=el('div','rss-feed-subtitle');line.append(header.lastChild!,this.dots('rss-refresh-dots','正在获取订阅'));header.append(line,this.listActions());cards=el('div','rss-feed');host.append(header,cards);}
    host.querySelector('.rss-page-title')!.textContent=this.heading();
    const selected=sourceIdsFor(this.filter,this.options.repo.state.sources),subtitle=this.filter.mode==='custom'?this.options.repo.state.sources.filter(s=>selected.includes(s.id)).map(s=>s.title).join(' + ')||'未选择来源':'所有订阅';
    host.querySelector('.rss-feed-head .rss-muted')!.textContent=this.filter.mode==='history'?'最近阅读的文章 · 最多保留20篇':`${subtitle}${this.filter.tags.length?' · '+this.filter.tags.join(' / '):''} · 按发布时间排序`;
    const articles=filterArticles(this.options.repo.state,this.filter);this.page=Math.min(this.page,Math.max(0,Math.ceil(articles.length/50)-1));
    let empty=host.querySelector('.rss-empty');if(articles.length)empty?.remove();else{if(!empty){empty=el('div','rss-empty');host.append(empty);}const recent=this.filter.mode==='history';empty.replaceChildren(el('h2','',recent?'暂无观看历史':this.options.repo.state.sources.length?'这里还没有文章':'从喜欢的来源开始'),el('p','rss-muted',recent?'打开文章后会自动记录最近阅读的20篇文章。':this.options.repo.state.sources.length?'尝试调整来源、标签，或刷新订阅。':'添加 RSS / Atom 地址，或导入已有 OPML 订阅。'));if(!recent&&!this.options.repo.state.sources.length)empty.append(button('添加订阅',()=>this.settings()));}
    const visible=articles.slice(this.page*50,this.page*50+50),ids=new Set(visible.map(a=>a.id));this.options.translation?.ensureHeaders(visible);if(this.filter.mode==='later')this.options.translation?.resumeLater();
    for(const child of [...cards.children])if(!ids.has((child as HTMLElement).dataset.articleId!)){this.imageObserver?.unobserve(child);child.remove();}
    visible.forEach((article,index)=>{let node=this.cardNodes.get(article.id);if(!node){node=this.card(article);this.cardNodes.set(article.id,node);}this.patchCard(node,article);if(cards!.children[index]!==node)cards!.insertBefore(node,cards!.children[index]??null);if(!node.started)this.observer().observe(node);});
    for(const [id,node] of this.cardNodes)if(this.cardNodes.size>150&&!node.isConnected)this.cardNodes.delete(id);
    host.querySelector('.rss-pager')?.remove();if(articles.length>50){const pager=el('div','rss-pager'),prev=button('上一页',()=>{this.page--;this.listScroll=0;this.listPosition={top:0};this.renderList();}),next=button('下一页',()=>{this.page++;this.listScroll=0;this.listPosition={top:0};this.renderList();});prev.disabled=this.page===0;next.disabled=(this.page+1)*50>=articles.length;pager.append(prev,el('span','rss-muted',`${this.page+1} / ${Math.ceil(articles.length/50)}`),next);host.append(pager);}
    this.updateActivity();this.restore(position);
  }
  private listActions():HTMLElement {
    const actions=el('div','rss-page-actions yzc-space-actions');actions.dataset.spaceActions='rss';
    const refresh=hostIconButton('刷新订阅','iconRefresh',()=>{
      const icon=refresh.querySelector('svg');
      if(icon&&!matchMedia('(prefers-reduced-motion:reduce)').matches&&!icon.getAnimations().some(a=>a.playState==='running'))icon.animate([{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:480,easing:'cubic-bezier(.2,.7,.3,1)'});
      void action(refresh,()=>this.refresh(),this.report);
    });
    actions.append(refresh,hostIconButton('RSS 设置','iconSettings',()=>this.settings()));return actions;
  }
  private dots(className:string,label:string):HTMLElement{const node=el('span','rss-dots '+className);node.setAttribute('role','status');node.setAttribute('aria-label',label);node.dataset.active='false';node.setAttribute('aria-hidden','true');for(let i=0;i<3;i++){const dot=el('i');dot.setAttribute('aria-hidden','true');node.append(dot);}return node;}
  private updateActivity():void{
    const refresh=this.content?.querySelector<HTMLElement>('.rss-refresh-dots'),translation=this.content?.querySelector<HTMLElement>('.rss-translation-dots'),key=this.filterKey(),now=performance.now();
    const busy=this.reloads.has(key)||this.options.service.isRefreshing(sourceIdsFor(this.filter,this.options.repo.state.sources));
    clearTimeout(this.activityTimer);if(key!==this.activityKey){this.activityKey=key;this.listActive=false;}
    if(busy){if(!this.listActive)this.activityStarted=now;this.listActive=true;}
    else if(this.listActive&&now-this.activityStarted<280)this.activityTimer=setTimeout(()=>this.updateActivity(),280-(now-this.activityStarted));else this.listActive=false;
    for(const [node,active] of [[refresh,this.listActive],[translation,!!this.selected&&!!this.options.translation?.isPending(this.selected.id)]] as const)if(node){node.dataset.active=String(active);node.setAttribute('aria-hidden',String(!active));}
  }
  private reloadList():Promise<void>{
    const key=this.filterKey(),pending=this.reloads.get(key);if(pending)return pending;
    const job=Promise.resolve().then(()=>this.options.repo.reload()).then(()=>{if(!this.closed&&this.screen==='list'&&this.filterKey()===key)this.renderList(true);}).finally(()=>{this.reloads.delete(key);if(!this.closed)this.updateActivity();});this.reloads.set(key,job);this.updateActivity();return job;
  }
  private live(id:string):Article{return this.options.repo.state.articles.find(a=>a.id===id)!;}
  private card(article:Article):Card{
    const node=el('article','rss-card') as Card;node.dataset.articleId=article.id;
    node.addEventListener('click',e=>{if(!(e.target as Element).closest('button,a,input,label'))void this.read(this.live(article.id));});
    const open=button('',()=>void this.read(this.live(article.id)),'rss-card-open'),copy=el('div','rss-card-copy');copy.append(el('h2','rss-card-title'));open.append(copy);
    const footer=el('footer','rss-card-footer');footer.append(el('span','rss-meta'));node.append(open,footer);return node;
  }
  private patchCard(node:Card,article:Article):void{
    const open=node.querySelector<HTMLButtonElement>('.rss-card-open')!,copy=node.querySelector('.rss-card-copy')!;
    const translated=this.options.translation?.header(article.id),name=article.titleZh||translated?.title||article.title,excerpt=article.summaryZh||translated?.summary||article.summary;
    open.setAttribute('aria-label',`阅读：${name}`);const title=node.querySelector('.rss-card-title')!;if(title.textContent!==name)title.textContent=name;
    let summary=copy.querySelector('.rss-summary');if(excerpt){if(!summary){summary=el('p','rss-summary');copy.append(summary);}if(summary.textContent!==excerpt)summary.textContent=excerpt;}else summary?.remove();
    node.querySelector('.rss-meta')!.textContent=this.meta(article);
    const key=JSON.stringify([article.later,!!this.options.repo.state.imports[article.id]?.completed]);if(node.actionKey!==key){node.querySelector('.rss-article-actions')?.remove();node.querySelector('.rss-card-footer')!.append(this.actions(article));node.actionKey=key;}
    const wanted=article.previewCover||article.cover||'';
    if(node.wanted!==wanted||!node.loadPreview){node.wanted=wanted;node.started=false;const token=node.imageToken=(node.imageToken??0)+1;
      node.loadPreview=()=>{if(node.started)return;node.started=true;void this.loadCover(node,article,token);};
    }
  }
  private async loadCover(node:Card,article:Article,token:number):Promise<void>{
    const current=()=>node.isConnected&&token===node.imageToken&&!this.closed;
    let completed=false,fallbackStarted=false,timer:ReturnType<typeof setTimeout>|undefined;
    const show=async(src:string|undefined,url:string)=>{
      if(!src||!current()||completed)return;
      const img=el('img','rss-cover');img.alt='';img.decoding='async';img.referrerPolicy='no-referrer';img.src=src;
      try{await img.decode();}catch{return;}
      if(!current()||completed)return;completed=true;clearTimeout(timer);
      node.querySelector('.rss-cover')?.remove();node.querySelector('.rss-card-open')!.append(img);
      if(article.cover&&url!==article.cover)this.options.cache.cancel?.(article.cover);
      this.options.cache.trace?.({event:'visible',url,t:performance.now(),at:Date.now(),article:article.id});
    };
    const alternate=async()=>{if(fallbackStarted||completed||!current())return;fallbackStarted=true;const url=await this.options.service.preview(this.live(article.id),!!article.previewCover);if(url&&url!==article.cover)await show(await this.options.cache.get(url,true),url);};
    const url=article.previewCover||article.cover;
    if(url){timer=setTimeout(()=>void alternate().catch(()=>{}),700);void this.options.cache.get(url).then(src=>{if(src)return show(src,url);return alternate();}).catch(()=>alternate()).catch(()=>{});}
    else await alternate();
  }
  private meta(article:Article):string{const source=this.options.repo.state.sources.find(s=>s.id===article.sourceId)?.title??'来源';return [chineseDate(article.published),...displayIdentity(source,article.author)].join(' · ');}
  private actions(article:Article,reader=false):HTMLElement{
    const live=this.live(article.id)??article,actions=el('div','rss-article-actions');
    if(reader&&this.options.translation){const bilingual=iconButton('双语','bilingual',()=>this.toggleBilingual(),true);bilingual.classList.add('rss-bilingual');bilingual.setAttribute('aria-pressed',String(this.bilingual));bilingual.disabled=!this.reading?.plan.needed;actions.append(bilingual);}
    const later=iconButton(live.later?'已加入':'稍后看',live.later?'later-filled':'later',()=>void action(later,()=>this.options.service.toggleLater(article.id),this.report),true);later.classList.add('rss-later');later.setAttribute('aria-pressed',String(live.later));
    const imported=!!this.options.repo.state.imports[article.id]?.completed;
    const inbox=iconButton(imported?'已转未分类':'转入未分类',imported?'inbox-completed':'inbox',()=>void action(inbox,async()=>{if(!imported)this.options.message('正在准备中文内容，译文完整后转入未分类…');const id=await this.options.inbox.import(this.live(article.id)??article);this.options.message(`已保存到未分类 · 文档 ${id}`);},this.report),true);inbox.classList.add('rss-inbox');inbox.setAttribute('aria-pressed',String(imported));actions.append(later,inbox);return actions;
  }
  private async read(article:Article,restoreTop=0):Promise<void>{
    this.options.translation?.releaseReader(this.selected?.id);this.reading=undefined;this.bilingual=false;this.translationError='';this.translating=false;this.translationToken++;this.scroll?.querySelector('.rss-reader-toolbar')?.remove();
    if(this.screen==='list'){this.listPosition=this.position();this.listScroll=this.listPosition.top;}else this.remember();this.selected=article;this.body=undefined;this.screen='reader';this.readerScroll=restoreTop;this.cancelRestore?.();this.imageObserver?.disconnect();this.imageObserver=undefined;
    const generation=++this.generation;this.content?.replaceChildren(articleBack(()=>this.back()),el('p','rss-muted','正在读取文章…'));if(this.scroll)this.scroll.scrollTop=0;
    try{const body=await this.options.service.read(article);if(generation!==this.generation||this.closed||this.screen!=='reader')return;this.body=body;this.renderReader();this.restore({top:restoreTop});try{await this.options.repo.recordOpened(article.id);}catch(error){this.report(error);}}catch(error){this.report(error);if(generation===this.generation)this.content?.replaceChildren(articleBack(()=>this.back()),el('p','rss-error','读取失败，请返回列表后重试。'));}
  }
  private renderReader():void{
    const host=this.content,article=this.selected;if(!host||!article||!this.body)return;this.closeTags?.();const scroll=this.scroll?.scrollTop??this.readerScroll;this.imageObserver?.disconnect();this.imageObserver=undefined;host.replaceChildren();
    const toolbar=el('div','rss-reader-toolbar'),info=el('div','rss-reader-info');info.append(articleBack(()=>this.back()),this.actions(article,true));toolbar.append(info);host.append(toolbar);
    if(this.scroll)this.scroll.style.scrollPaddingTop='38px';
    const header=el('header','rss-reader-header'),heading=el('div','protyle-title rss-reader-title');header.append(heading);
    const provenance=el('p','rss-muted rss-provenance',this.meta(article));if(article.url){const link=el('a','','阅读原文 ↗');link.href=article.url;link.target='_blank';link.rel='noopener noreferrer';provenance.append(' · ',link);}header.append(provenance);
    if(this.body.api){const info=this.body.api,versions=el('select','rss-version-select');versions.setAttribute('aria-label','正文版本');for(const [key,label]of [['rewrite','第三方 AI 整理 / 改写'],['translation','第三方中文翻译'],['original',info.originalKind]] as const){if(key!=='original'&&!info[key]?.html)continue;const option=el('option','',label);option.value=key;versions.append(option);}versions.value=this.body.apiChoice??(info.rewrite?.html?'rewrite':info.translation?.html?'translation':'original');if(!info.rewrite?.html&&!info.translation?.html){const opt=el('option','','本地中文翻译');opt.value='local';versions.prepend(opt);versions.value=this.body.apiChoice==='original'?'original':'local';}versions.onchange=()=>{this.translationToken++;this.body!.apiChoice=versions.value==='local'?undefined:versions.value as 'rewrite'|'translation'|'original';this.reading=undefined;this.renderReader();};provenance.append(' · API · '+info.serviceName+' · ',versions);if(info.error)header.append(el('p','rss-muted',info.error));}

    const tags=el('div','rss-inline-tags'),addTag=iconButton('编辑文章标签','tag-add',()=>this.tagMenu(tags,article.id));addTag.classList.add('rss-add-tag');tags.append(el('span','rss-tag-text'),addTag);header.append(tags);host.append(header);this.updateReaderTags();
    const current=this.live(article.id)??article,cover=current.previewCover||current.cover,generation=this.generation;
    if(cover){const hero=el('div','rss-reader-hero');host.prepend(hero);void this.options.cache.get(cover).then(async url=>{if(!url){hero.remove();return;}const img=el('img','rss-reader-cover');img.alt='文章题头图';img.decoding='async';img.src=url;try{await img.decode();}catch{hero.remove();return;}if(this.generation===generation&&hero.isConnected)hero.append(img);}).catch(()=>hero.remove());}
    host.append(el('article','rss-reader-body b3-typography'));this.renderedParts.clear();this.renderReadingContent();
    if(this.options.translation&&!this.reading)void this.translateReading();if(this.scroll)this.scroll.scrollTop=scroll;
  }
  private decorateBody(body:HTMLElement):void{
    this.imageObserver?.disconnect();this.imageObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){this.imageObserver?.unobserve(entry.target);const img=entry.target as HTMLImageElement;void this.options.cache.get(img.dataset.rssSrc!).then(url=>{if(url&&img.isConnected)img.src=url;else img.remove();}).catch(()=>img.remove());}},{root:this.scroll,rootMargin:'250px'});
    body.querySelectorAll<HTMLImageElement>('img').forEach(img=>{img.onerror=()=>img.remove();if(img.dataset.rssSrc&&img.getAttribute('src'))return;img.dataset.rssSrc=img.dataset.rssSrc||img.src;img.removeAttribute('src');img.style.minHeight='70px';this.imageObserver?.observe(img);});
    body.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h=>{h.setAttribute('data-type','NodeHeading');h.setAttribute('data-subtype',h.tagName.toLowerCase());});body.querySelectorAll('p').forEach(p=>p.setAttribute('data-type','NodeParagraph'));body.querySelectorAll('blockquote').forEach(p=>p.setAttribute('data-type','NodeBlockquote'));
    this.syncTypography();
  }
  private updateReaderTitle():void{
    const article=this.selected,heading=this.content?.querySelector('.rss-reader-title');if(!article||!heading)return;
    let title=heading.querySelector('h1');if(!title){title=el('h1','protyle-title__input');heading.append(title);}const value=this.reading?.cache.parts['title-0']??this.reading?.plan.title??(article.titleZh||this.options.translation?.header(article.id)?.title||article.title);if(title.firstChild?.nodeType!==3)title.prepend(document.createTextNode(''));(title.firstChild as Text).data=value;if(!title.querySelector('.rss-translation-dots'))title.append(this.dots('rss-translation-dots','正在翻译文章'));this.updateActivity();
    let original=heading.querySelector('.rss-original-title');if(this.bilingual&&this.reading?.plan.needed){if(!original){original=el('div','rss-original-title',article.title);heading.prepend(original);}}else original?.remove();
  }
  private readingAnchor():{id:string;offset:number}|undefined{
    if(!this.scroll||this.scroll.scrollTop<300)return;const base=this.scroll.getBoundingClientRect().top+38,anchor=[...(this.content?.querySelectorAll<HTMLElement>('[data-rss-block]')??[])].find(e=>e.getBoundingClientRect().bottom>base);if(anchor)return{id:anchor.dataset.rssBlock!,offset:anchor.getBoundingClientRect().top-base};
  }
  private restoreReadingAnchor(anchor:{id:string;offset:number}|undefined):void{if(!anchor||!this.scroll)return;const target=this.content?.querySelector(`[data-rss-block="${anchor.id}"]`);if(target)this.scroll.scrollTop+=target.getBoundingClientRect().top-this.scroll.getBoundingClientRect().top-38-anchor.offset;}
  private focusReading():void{
    if(!this.selected||!this.reading||this.screen!=='reader'||!this.scroll)return;const base=this.scroll.getBoundingClientRect().top+38,parts=[...(this.content?.querySelectorAll<HTMLElement>('[data-rss-part]')??[])].filter(p=>!p.closest('.rss-original-block'));let start=parts.findIndex(e=>e.getBoundingClientRect().bottom>base);if(start<0)start=0;
    const visible=parts.slice(start).filter(e=>e.getBoundingClientRect().top<this.scroll!.getBoundingClientRect().bottom+300);this.options.translation?.focus(this.selected.id,[...new Set([...visible,...parts.slice(start,start+6)])].map(e=>e.dataset.rssPart!));
  }
  private preserveImages(body:HTMLElement,change:()=>void):void{
    const images=new Map<string,HTMLImageElement[]>();body.querySelectorAll<HTMLImageElement>('img').forEach(img=>{const key=img.dataset.rssSrc||img.src;images.set(key,[...(images.get(key)??[]),img]);});change();body.querySelectorAll<HTMLImageElement>('img').forEach(img=>{const existing=images.get(img.src)?.shift();if(existing&&existing!==img)img.replaceWith(existing);});
  }
  private renderReadingContent():void{
    const article=this.selected,body=this.content?.querySelector<HTMLElement>('.rss-reader-body');if(!article||!this.body||!body)return;this.updateReaderTitle();
    if(this.options.translation&&!this.reading){body.replaceChildren(el('p','rss-muted rss-translation-status','正在读取中文缓存…'));return;}
    const anchor=this.readingAnchor(),key=(this.reading?.plan.fingerprint??'original')+':'+this.bilingual;
    if(body.dataset.plan!==key){this.preserveImages(body,()=>{body.innerHTML=readerHtml(this.reading?.plan.needed?translatedContent(this.reading,this.bilingual).html:safeHtml(this.reading?.plan.html??this.body!.html,article.url));});body.dataset.plan=key;this.renderedParts=new Map(Object.entries(this.reading?.cache.parts??{}));}
    else if(this.reading)for(const [id,value] of Object.entries(this.reading.cache.parts)){
      if(this.renderedParts.get(id)===value)continue;for(const part of body.querySelectorAll<HTMLElement>(`[data-rss-part="${id}"]`)){if(part.closest('.rss-original-block'))continue;this.preserveImages(part,()=>{part.innerHTML=readerHtml(value);});part.classList.remove('rss-translation-pending');part.style.removeProperty('min-height');}this.renderedParts.set(id,value);
    }
    this.decorateBody(body);let status=body.querySelector<HTMLElement>(':scope > .rss-reader-status');
    const complete=!this.reading?.plan.needed||this.reading.cache.state==='ready';
    if(complete&&!this.translationError)status?.remove();else{if(!status){status=el('div','rss-muted rss-reader-status');status.setAttribute('role','status');body.append(status);}status.replaceChildren(el('span','',this.translationError?`部分译文未完成：${this.translationError}`:`已翻译 ${Object.keys(this.reading?.cache.parts??{}).length} / ${this.reading?.plan.units.length??0}，其余内容继续处理。`));if(this.translationError)status.append(button('重试未完成内容',()=>{void this.options.translation?.retry(article.id).then(()=>{this.translationError='';void this.translateReading();}).catch(this.report);},'rss-text-button'));}
    this.restoreReadingAnchor(anchor);this.updateBilingual();this.focusReading();
  }
  private updateBilingual():void{const button=this.scroll?.querySelector<HTMLButtonElement>('.rss-bilingual');if(button){button.disabled=!this.reading?.plan.needed;button.setAttribute('aria-pressed',String(this.bilingual));button.title=this.reading&&!this.reading.plan.needed?'本文无需英文翻译':'切换中文 / 双语';}}
  private async translateReading():Promise<void>{
    const article=this.selected,body=this.body,translation=this.options.translation;if(!article||!body||!translation)return;const token=++this.translationToken;this.translating=true;
    const current=()=>token===this.translationToken&&this.screen==='reader'&&this.selected?.id===article.id&&!this.closed&&!!this.content;
    try{const prepared=await translation.prepare(article,body);if(!current())return;this.reading=prepared;this.renderReadingContent();const result=await translation.translate(article,body,p=>{if(current()){this.reading=p.result;this.renderReadingContent();}});if(current()){this.reading=result;this.translating=false;this.renderReadingContent();}}
    catch(error){if(current()){this.translating=false;this.translationError=(error as Error).message;this.renderReadingContent();}}
  }
  private toggleBilingual():void{if(!this.reading?.plan.needed||!this.scroll)return;this.cancelRestore?.();const anchor=this.readingAnchor(),top=this.scroll.scrollTop;this.bilingual=!this.bilingual;this.renderReadingContent();if(anchor)this.restoreReadingAnchor(anchor);else this.scroll.scrollTop=top;}

  private updateReaderTags():void{const text=this.content?.querySelector('.rss-tag-text');if(text&&this.selected)text.textContent=(this.live(this.selected.id)?.tags??[]).join(' · ');}
  private tagMenu(anchor:HTMLElement,id:string):void{
    if(this.closeTags){this.closeTags();return;}
    const controller=new AbortController(),menu=el('div','rss-tag-menu'),search=input('搜索或新建文章标签'),choices=el('div','rss-tag-choices');menu.setAttribute('role','dialog');menu.setAttribute('aria-label','文章标签');menu.append(search.wrap,choices);anchor.append(menu);anchor.classList.add('rss-tags-open');
    const close=()=>{controller.abort();menu.remove();anchor.classList.remove('rss-tags-open');this.closeTags=undefined;anchor.querySelector<HTMLButtonElement>('.rss-add-tag')?.focus({preventScroll:true});};this.closeTags=close;
    const change=async(tag:string,remove=false)=>{await this.options.repo.update(s=>{const article=s.articles.find(a=>a.id===id);if(!article)throw Error('文章已不存在。');article.tags=remove?article.tags.filter(t=>t!==tag):[...new Set([...article.tags,tag])];if(!remove)s.tags=[...new Set([...s.tags,tag])];});if(menu.isConnected){render();search.field.focus();}};
    const render=()=>{choices.replaceChildren();const selected=this.live(id)?.tags??[],query=search.field.value.trim(),available=this.options.repo.state.tags.filter(t=>t.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
      for(const tag of [...selected,...available.filter(t=>!selected.includes(t))]){const b=button(`${selected.includes(tag)?'✓ ':''}${tag}`,()=>void action(b,()=>change(tag,selected.includes(tag)),this.report),'rss-tag-choice');b.setAttribute('aria-pressed',String(selected.includes(tag)));b.title=selected.includes(tag)?`移除 ${tag}`:`添加 ${tag}`;choices.append(b);}
      if(query&&!this.options.repo.state.tags.includes(query)){const create=button(`新建并添加「${query}」`,()=>void action(create,()=>change(query),this.report),'rss-tag-choice');choices.append(create);}
    };search.field.addEventListener('input',render);search.field.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();const tag=search.field.value.trim();if(tag)void change(this.options.repo.state.tags.find(t=>t.toLocaleLowerCase()===tag.toLocaleLowerCase())??tag).catch(this.report);}});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close();}},{capture:true,signal:controller.signal});document.addEventListener('pointerdown',event=>{if(!anchor.contains(event.target as Node))close();},{signal:controller.signal});render();search.field.focus();
  }
  private back():void{this.remember();this.options.translation?.releaseReader(this.selected?.id);this.readerScroll=this.scroll?.scrollTop??this.readerScroll;this.screen='list';++this.generation;for(const node of this.cardNodes.values())node.started=false;this.renderList();}
  settings():void{
    this.closeTags?.();
    if(this.closeSettings)return;if(!this.content){this.settingsRequested=true;return;}this.settingsRequested=false;
    const previous=document.activeElement as HTMLElement|null,overlay=el('div','rss-tab rss-settings-overlay'),panel=el('section','rss-settings-dialog');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','RSS 设置');overlay.append(panel);document.body.append(overlay);
    const backgrounds=[this.content.closest<HTMLElement>('.rss-tab'),this.sidebar].filter((e):e is HTMLElement=>!!e);
    const saved=backgrounds.map(e=>({e,aria:e.getAttribute('aria-hidden'),inert:e.inert}));backgrounds.forEach(e=>{e.inert=true;e.setAttribute('aria-hidden','true');});
    const close=()=>{document.removeEventListener('keydown',keydown,true);overlay.remove();saved.forEach(({e,aria,inert})=>{e.inert=inert;if(aria===null)e.removeAttribute('aria-hidden');else e.setAttribute('aria-hidden',aria);});this.closeSettings=undefined;if(previous?.isConnected)previous.focus({preventScroll:true});};
    const keydown=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();const drawer=panel.querySelector('.rss-drawer-overlay'),choices=(drawer??panel).querySelector<HTMLDetailsElement>('.rss-group-picker details[open],.rss-select details[open]');if(choices){choices.open=false;const summary=choices.querySelector<HTMLElement>('summary');summary?.setAttribute('aria-expanded','false');summary?.focus({preventScroll:true});}else if(drawer)drawer.dispatchEvent(new Event('rss-drawer-close'));else close();}else if(event.key==='Tab'){const scope=panel.querySelector('.rss-drawer-overlay')??panel;const nodes=[...scope.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select,textarea,summary,a[href]')].filter(e=>e.getClientRects().length);const i=nodes.indexOf(document.activeElement as HTMLElement);if(event.shiftKey&&i<=0){event.preventDefault();nodes.at(-1)?.focus();}else if(!event.shiftKey&&i===nodes.length-1){event.preventDefault();nodes[0]?.focus();}}};
    overlay.addEventListener('click',event=>{if(event.target===overlay){const drawer=panel.querySelector('.rss-drawer-overlay');if(drawer)drawer.dispatchEvent(new Event('rss-drawer-close'));else close();}});document.addEventListener('keydown',keydown,true);this.closeSettings=close;
    renderSettings(panel,{...this.options,back:close,openSource:id=>{if(!this.options.repo.state.sources.some(s=>s.id===id)){this.report(Error('来源已不存在。'));return;}close();this.select({...allFilter(),mode:'source',value:id},false,false);},openArticle:id=>{const a=this.live(id);if(!a){this.report(Error('文章已不存在。'));return;}const top=this.selected?.id===id?(this.scroll?.scrollTop??0):this.articlePositions.get(id)??[...this.history.values()].reverse().find(p=>p.article===id)?.reader??0;close();void this.read(a,top);},articleTitle:a=>a.titleZh||this.options.translation?.header(a.id)?.title||a.title,groupRenamed:(from,to)=>{if(this.filter.mode==='group'&&this.filter.value===from){this.filter.value=to;this.renderList(true);}if(this.collapsed.delete(from))this.collapsed.add(to);this.renderSidebar();},treeIcons:()=>this.treeIcons(),setTreeIcons:value=>this.setTreeIcons(value)});this.syncHost();panel.querySelector<HTMLButtonElement>('.rss-settings-nav button[aria-current=true]')?.focus();
  }
  async refresh(resetPosition=true,respectTagScope=false):Promise<void>{
    this.options.translation?.releaseReader(this.selected?.id);this.closeSettings?.();this.screen='list';this.selected=undefined;this.body=undefined;if(resetPosition){this.listScroll=0;this.listPosition={top:0};this.page=0;}++this.generation;for(const node of this.cardNodes.values())if(!node.querySelector('.rss-cover'))node.started=false;this.renderList(!resetPosition);if(resetPosition&&this.scroll)this.scroll.scrollTop=0;
    if(this.filter.mode==='later'||this.filter.mode==='history'||(respectTagScope&&this.filter.tags.length)){await this.reloadList();return;}
    const result=await this.options.service.refresh(sourceIdsFor(this.filter,this.options.repo.state.sources));this.options.message(`${result.total-result.failed-result.skipped} 个来源已刷新${result.failed?`，${result.failed} 个失败`:''}${result.skipped?`，${result.skipped} 个等待重试`:'。'}`,result.failed>0);
  }
  reselect():void{void this.refresh().catch(this.report);}
  dispose():void{this.closed=true;clearTimeout(this.activityTimer);this.unsubscribeRefresh();this.unsubscribeTranslation();this.unsubscribe();this.closeSettings?.();this.imageObserver?.disconnect();this.sidebar.remove();this.detach();this.typography.dispose();this.cardNodes.clear();}
}
