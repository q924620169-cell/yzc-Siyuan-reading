import {withWorkspaceLock} from '../storage';
import type {Repository} from '../storage';
import type {RssService} from '../service';
import type {ImageCache} from '../cache';
import type {InlBridge} from '../bridge';
import {el,button,input,action,checkbox} from './dom';
import type {SubscriptionCandidate,SubscriptionPlan} from '../sources';
import {TRANSLATION,type TranslationService} from '../translation';
import {apiSettings} from './api-settings';
import {openDrawer} from './settings-drawer';
import {sourceManagement,sourceEditor,taxonomyManagement} from './settings-manage';

export interface SettingsOptions {
  repo:Repository;service:RssService;cache:ImageCache;bridge:()=>InlBridge|undefined;
  translation?:TranslationService;
  message:(text:string,error?:boolean)=>void;back:()=>void;reschedule:()=>void;openSource?:(id:string)=>void;openArticle?:(id:string)=>void;articleTitle?:(article:import('../model').Article)=>string;groupRenamed?:(from:string,to:string)=>void;treeIcons?:()=>boolean;setTreeIcons?:(value:boolean)=>void;
}
export function renderSettings(host:HTMLElement,options:SettingsOptions):void{
  const {repo,service,cache,message}=options;
  const report=(e:unknown)=>message((e as Error).message,true);
  host.replaceChildren();host.onpointerdown=e=>{for(const d of host.querySelectorAll<HTMLDetailsElement>('.rss-select details[open]'))if(!d.contains(e.target as Node))d.open=false;};
  const layout=el('div','rss-settings-layout'),navigation=el('nav','rss-settings-nav'),content=el('div','rss-settings-body');navigation.setAttribute('aria-label','RSS 设置导航');navigation.append(el('h1','rss-page-title','RSS 设置'));layout.append(navigation,content);host.append(layout);
  if(host.dataset.section==='来源与导入')host.dataset.section='订阅源';if(host.dataset.section==='标签管理')host.dataset.section='分组与标签';
  if(host.dataset.section==='浏览与刷新')host.dataset.section='自动刷新';
  const tabs=['订阅源','分组与标签','自动刷新','翻译','图片缓存','数据与清理'];
  const sections:HTMLElement[]=[];let refreshSources=()=>{},refreshTaxonomy=()=>{};
  const activate=(tab:string)=>{host.dataset.section=tab;navigation.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.setAttribute('aria-current',String(b.textContent===tab)));sections.forEach(s=>{s.hidden=s.dataset.section!==tab;});content.scrollTop=0;if(tab==='订阅源')refreshSources();if(tab==='分组与标签')refreshTaxonomy();};
  for(const tab of tabs)navigation.append(button(tab,()=>activate(tab),'rss-nav-item'));
  const section=(title:string,detail?:string)=>{
    const node=el('section','rss-settings-section');node.dataset.section=title==='添加订阅'||title==='订阅源管理'?'订阅源':title==='分组与标签'?'分组与标签':title==='自动刷新与保留期限'?'自动刷新':title==='翻译'?'翻译':title==='图片缓存'?'图片缓存':'数据与清理';
    node.hidden=node.dataset.section!==(host.dataset.section||tabs[0]);sections.push(node);node.append(el('h2','',title));if(detail)node.append(el('p','rss-muted',detail));content.append(node);return node;
  };
  const openAdd=()=>openDrawer(host,'添加来源',(body,close)=>{
    const form=el('form','rss-subscribe-form'),url=input('订阅地址','','url');
    url.field.required=true;url.field.placeholder='粘贴网站、RSS 或 OPML 地址';
    const add=button('添加订阅',()=>{});add.type='submit';add.classList.add('rss-primary');
    form.append(url.wrap,add);
    const file=input('导入 OPML 文件','','file').field;
    file.accept='.opml,.xml';file.hidden=true;
    const chooseFile=button('选择 OPML 文件',()=>{file.value='';file.click();});
    const status=el('p','rss-muted'),preview=el('div','rss-subscription-preview');
    status.setAttribute('role','status');status.hidden=true;
    const advanced=el('details','rss-subscribe-advanced'),summary=el('summary','','高级：API 服务'),api=el('div','rss-api-inputs');
    advanced.append(summary,api);
    advanced.addEventListener('toggle',()=>{if(advanced.open&&!api.childNodes.length)apiSettings(api,service,message,()=>{void finish();});});
    body.append(form,chooseFile,file,status,preview,advanced);
    const finish=async()=>{await close();refreshSources();refreshTaxonomy();};
    const setStatus=(text:string,error=false)=>{status.hidden=!text;status.textContent=text;status.classList.toggle('rss-error',error);};
    const run=async(work:()=>Promise<void>,text:string)=>{
      if(add.disabled)return;
      add.disabled=chooseFile.disabled=true;setStatus(text);
      try{await work();if(body.isConnected)setStatus('');}
      catch(error){setStatus((error as Error).message,true);}
      finally{add.disabled=chooseFile.disabled=false;}
    };
    const subscribe=async(candidates:SubscriptionCandidate[],kind:SubscriptionPlan['kind'])=>{
      if(kind==='opml'){
        const result=await service.importCandidates(candidates);
        if(!result.added&&result.failed.length)throw Error(result.failed.join('；'));
        await finish();
        message(`已添加 ${result.added} 个来源。`);
        if(result.failed.length)message(result.failed.join('；'),true);
      }else{
        const candidate=candidates[0];
        await service.add(candidate.url,candidate.title,candidate.group,[]);
        await finish();message('订阅已添加。');
      }
    };
    const prepare=async(value:string)=>{
      preview.replaceChildren();
      const plan=await service.prepare(value);
      if(!body.isConnected||body.closest<HTMLElement>('.rss-drawer-overlay')?.dataset.closing)return;
      const available=plan.candidates.filter(candidate=>!candidate.existing);
      if(!available.length)throw Error('这些来源已经添加。已停止的来源可在订阅源中恢复。');
      if(available.length===1){await subscribe(available,plan.kind);return;}
      const selection=el('form','rss-subscription-selection');
      selection.append(el('h3','',plan.kind==='opml'?'选择要导入的订阅':'为这个网站选择订阅源'));
      const selected=new Set(plan.kind==='opml'?available.map(candidate=>candidate.url):[available[0].url]);
      const confirm=button(plan.kind==='opml'?'导入所选订阅':'添加所选订阅',()=>{});confirm.type='submit';
      for(const candidate of available){
        const field=checkbox(candidate.title||candidate.url,selected.has(candidate.url),checked=>{
          if(plan.kind!=='opml')selected.clear();
          if(checked)selected.add(candidate.url);else selected.delete(candidate.url);
          confirm.disabled=!selected.size;
        });
        if(plan.kind!=='opml'){const radio=field.querySelector('input')!;radio.type='radio';radio.name='rss-feed-choice';}
        selection.append(field);
      }
      const cancel=button('取消',()=>preview.replaceChildren());
      selection.append(confirm,cancel);preview.append(selection);
      selection.onsubmit=event=>{
        event.preventDefault();
        if(confirm.disabled)return;
        confirm.disabled=cancel.disabled=true;
        void run(()=>subscribe(available.filter(candidate=>selected.has(candidate.url)),plan.kind),'正在添加订阅…')
          .finally(()=>{confirm.disabled=cancel.disabled=false;});
      };
    };
    form.onsubmit=event=>{event.preventDefault();void run(()=>prepare(url.field.value),'正在识别订阅地址…');};
    file.onchange=()=>{const chosen=file.files?.[0];if(chosen)void run(async()=>prepare(await chosen.text()),'正在读取订阅文件…');};
  });
  const sources=section('订阅源管理');const heading=el('div','rss-management-head'),sourceTitle=sources.querySelector('h2')!;sourceTitle.textContent='订阅源';heading.append(sourceTitle,el('span','rss-muted rss-source-total'),button('添加来源',()=>openAdd()));sources.prepend(heading);refreshSources=sourceManagement(sources,repo,service,message,id=>openDrawer(host,'编辑来源',(body,close)=>sourceEditor(body,repo,service,id,close,()=>{refreshSources();refreshTaxonomy();},message)));
  const taxonomy=section('分组与标签');refreshTaxonomy=taxonomyManagement(taxonomy,repo,message,host,{source:options.openSource,article:options.openArticle,title:options.articleTitle,groupRenamed:options.groupRenamed});
  const iconToggle=checkbox('在侧边栏显示分组与来源图标',options.treeIcons?.()??true,value=>options.setTreeIcons?.(value));
  iconToggle.classList.add('rss-icon-toggle');
  taxonomy.append(el('h2','rss-settings-subtitle','侧边栏图标'),el('p','rss-muted','与文档区使用同一套显示策略：关闭后侧边栏只保留文字。'),iconToggle);
  const general=section('自动刷新与保留期限','插件启用且思源运行时执行自动刷新；关闭思源后不会后台抓取。稍后看及已导入记录不随期限清理。');
  const interval=input('刷新间隔（分钟，0 为手动）',String(repo.state.settings.refreshMinutes),'number');
  interval.field.min='0';interval.field.max='1440';
  const retention=input('普通文章保留天数',String(repo.state.settings.retentionDays),'number');retention.field.min='1';retention.field.max='3650';
  const saveGeneral=button('保存刷新设置',()=>void action(saveGeneral,async()=>{
    const refreshMinutes=Number(interval.field.value),retentionDays=Number(retention.field.value);
    if(!Number.isInteger(refreshMinutes)||refreshMinutes<0||refreshMinutes>1440||!Number.isInteger(retentionDays)||retentionDays<1||retentionDays>3650)throw new Error('请输入有效的整数范围。');
    await repo.update(s=>Object.assign(s.settings,{refreshMinutes,retentionDays}));options.reschedule();message('刷新设置已保存。');
  },report));
  general.append(interval.wrap,retention.wrap,saveGeneral);
  const translation=section('翻译','刷新后自动翻译英文标题与摘要；打开文章或加入稍后看后翻译正文。原文将发送至 Index Translate 官方接口，默认显示中文。原文单独保留；双语切换只使用本地译文，不重复请求。');
  for(const [name,value] of [['模型',TRANSLATION.model],['服务地址',TRANSLATION.endpoint],['目标语言','简体中文']]){
    const field=input(name,value);field.field.readOnly=true;translation.append(field.wrap);
  }
  const counts=repo.state.articles.reduce((out,a)=>{if(a.translation?.state==='ready')out.ready++;else if(a.translation?.state==='failed')out.failed++;else if(a.translation?.state==='pending')out.pending++;return out;},{ready:0,failed:0,pending:0});
  translation.append(el('p','rss-muted',`正文翻译：${counts.ready} 篇完成，${counts.pending} 篇待完成，${counts.failed} 篇失败。标题与摘要独立保存；原文变化时只处理缺失内容，已完成分块可在重试时复用；与图片缓存独立。`));
  const connection=el('p','rss-muted');connection.setAttribute('role','status');
  const test=button('测试连接',()=>void action(test,async()=>{if(!options.translation)throw Error('当前环境没有翻译连接。');connection.textContent='正在测试官方接口…';const start=performance.now();const result=await options.translation.testConnection();connection.textContent=`连接成功 · ${Math.round(performance.now()-start)} ms · ${result}`;},e=>{connection.textContent=`连接失败：${(e as Error).message}`;report(e);}));
  translation.append(test,connection);
  const images=section('图片缓存',`已用 ${(Object.values(repo.state.cache).reduce((sum,x)=>sum+x.bytes,0)/1024/1024).toFixed(1)} MB。按最近使用淘汰；超过 30 天的缓存可清理。`);
  const limit=input('缓存上限（MB，0 为不缓存）',String(repo.state.settings.cacheMB),'number');limit.field.min='0';limit.field.max='1024';
  const saveLimit=button('保存容量并清理',()=>void action(saveLimit,async()=>{
    const cacheMB=Number(limit.field.value);if(!Number.isInteger(cacheMB)||cacheMB<0||cacheMB>1024)throw new Error('缓存上限应为 0–1024 MB。');
    await repo.update(s=>{s.settings.cacheMB=cacheMB;});await cache.trim();renderSettings(host,options);message('缓存容量已更新。');
  },report));
  const clearImages=button('清空图片缓存',()=>void action(clearImages,async()=>{await cache.clear();renderSettings(host,options);message('图片缓存已清空。');},report));
  images.append(limit.wrap,saveLimit,clearImages);
  const cleanup=section('本地文章清理','删除未收藏、未导入的缓存文章；保留订阅、稍后看、导入记录及所有真实思源文档。下次刷新可重新抓取。');
  const danger=el('details','rss-source-removal'),summary=el('summary','','清理普通文章');
  const confirm=el('div','rss-confirm');
  const clear=button('确认清理',()=>void action(clear,async()=>{
    const ids:string[]=[];
    await withWorkspaceLock('ingestion',async()=>{
      await repo.update(s=>{
        s.articles=s.articles.filter(a=>{
          if(a.later||a.importedId||s.imports[a.id])return true;
          ids.push(a.id);return false;
        });
        s.sources.forEach(x=>{delete x.etag;delete x.modified;});
      });
      for(const id of ids)await repo.removeBody(id);
    });
    message(`已清理 ${ids.length} 篇普通文章。`);renderSettings(host,options);
  },report));
  confirm.append(el('p','','将删除未收藏、未保存到思源的本地文章及其阅读记录。'),clear);
  danger.append(summary,confirm);cleanup.append(danger);
  activate(host.dataset.section||tabs[0]);
}
