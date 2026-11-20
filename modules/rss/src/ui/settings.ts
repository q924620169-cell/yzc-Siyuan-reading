import type {Repository} from '../storage';
import type {RssService} from '../service';
import type {ImageCache} from '../cache';
import type {InlBridge} from '../bridge';
import {el,button,input,tagsFrom,action,checkbox} from './dom';
import type {SubscriptionPlan} from '../sources';
import {TRANSLATION,type TranslationService} from '../translation';
import {apiSettings} from './api-settings';
import {openDrawer,groupPicker} from './settings-drawer';
import {segmented} from './settings-controls';
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
  const subscriptions=body;
  const form=el('form','rss-form'),url=input('订阅地址','','url'),title=input('名称（可选）'),group=groupPicker(repo.state.groups),tags=input('主题标签（逗号分隔）');
  url.field.required=true;url.field.placeholder='https://example.com/feed.xml';
  const add=button('添加订阅',()=>{});add.type='submit';
  form.append(url.wrap,title.wrap,group.wrap,tags.wrap,add);
  let revision=0;const finish=async()=>{revision++;await close();refreshSources();refreshTaxonomy();};
  const preview=el('div','rss-subscription-preview');
  const showPlan=(plan:SubscriptionPlan)=>{
    preview.replaceChildren();
    preview.append(el('h3','',plan.kind==='opml'?'导入预览':'选择订阅源'));
    const selected=new Set(plan.candidates.filter(c=>!c.existing).map(c=>c.url));
    if(plan.kind==='choose'){selected.clear();const first=plan.candidates.find(c=>!c.existing);if(first)selected.add(first.url);}
    for(const c of plan.candidates){
      const check=checkbox(`${c.title||c.url} · ${c.group}${c.existing?' · 已订阅，跳过':''}`,selected.has(c.url),checked=>{
        if(plan.kind==='choose'){
          selected.clear();
          preview.querySelectorAll<HTMLInputElement>('input').forEach(input=>{input.checked=false;});
          if(checked){selected.add(c.url);check.querySelector('input')!.checked=true;}
        }else checked?selected.add(c.url):selected.delete(c.url);
      });
      check.querySelector('input')!.disabled=!!c.existing;preview.append(check);
    }
    const cancel=button('取消',()=>{revision++;preview.replaceChildren();});
    const confirm=button(plan.kind==='opml'?'确认导入':'确认添加',()=>void action(confirm,async()=>{
      cancel.disabled=true;
      const candidates=plan.candidates.filter(c=>selected.has(c.url)&&!c.existing);
      if(!candidates.length)throw Error('请选择尚未订阅的来源。');
      if(plan.kind==='choose'){
        const c=candidates[0];await service.add(c.url,title.field.value||c.title,group.value(),tagsFrom(tags.field.value));
        message('订阅已添加并抓取。');await finish();
      }else{
        const result=await service.importCandidates(candidates.map(c=>group.value().length?{...c,groups:[...new Set([c.group,...group.value()])]}:c));
        message(`已添加 ${result.added} 个来源${result.failed.length?`，${result.failed.length} 个失败。`:'。'}`);
        await finish();
        if(result.failed.length)message(result.failed.join('；'),true);
      }
    },e=>{cancel.disabled=false;report(e);}));
    preview.append(confirm,cancel);
  };
  form.onsubmit=e=>{e.preventDefault();void action(add,async()=>{
    const token=++revision;preview.replaceChildren();
    const plan=await service.prepare(url.field.value);
    if(token!==revision||!body.isConnected||body.closest<HTMLElement>('.rss-drawer-overlay')?.dataset.closing)return;
    if(plan.kind!=='feed'){showPlan(plan);return;}
    const candidate=plan.candidates[0];
    await service.add(candidate.url,title.field.value||candidate.title,group.value(),tagsFrom(tags.field.value));
    message('订阅已添加并抓取。');await finish();
  },report);};
  subscriptions.append(form);
  const opml=input('导入 OPML 文件','','file');opml.field.accept='.opml,.xml';opml.field.hidden=true;opml.field.setAttribute('aria-label','导入 OPML 文件');const fileRow=el('div','rss-file-picker'),fileName=el('span','rss-file-name','未选择文件'),chooseFile=button('选择文件',()=>{opml.field.value='';opml.field.click();});fileName.setAttribute('role','status');fileRow.append(el('span','rss-muted','导入 OPML'),chooseFile,fileName,opml.field);
  opml.field.onchange=()=>{const file=opml.field.files?.[0];if(!file)return;fileName.textContent=file.name;fileName.title=file.name;
    opml.field.disabled=true;chooseFile.disabled=true;const token=++revision;
    void file.text().then(text=>service.prepare(text)).then(plan=>{
      if(token===revision&&body.isConnected&&!body.closest<HTMLElement>('.rss-drawer-overlay')?.dataset.closing)showPlan(plan);
    }).catch(report).finally(()=>{opml.field.disabled=false;chooseFile.disabled=false;});
  };
  subscriptions.append(fileRow,preview);
  const rssInputs=el('div','rss-rss-inputs'),apiInputs=el('div','rss-api-inputs');rssInputs.append(el('h3','rss-settings-subtitle','选择来源'),form,fileRow,preview);const apiMode=host.dataset.subscriptionMethod==='api';rssInputs.hidden=apiMode;apiInputs.hidden=!apiMode;apiSettings(apiInputs,service,message,()=>{void finish();});const methods=segmented(['RSS / Atom','API 服务'],apiMode?1:0,i=>{rssInputs.hidden=i===1;apiInputs.hidden=i===0;host.dataset.subscriptionMethod=i===1?'api':'rss';},'订阅方式');subscriptions.append(methods,rssInputs,apiInputs);
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
  const clear=button('清理普通文章',()=>void action(clear,async()=>{
    const ids=repo.state.articles.filter(a=>!a.later&&!a.importedId).map(a=>a.id);
    await repo.update(s=>{s.articles=s.articles.filter(a=>a.later||a.importedId);s.sources.forEach(x=>{delete x.etag;delete x.modified;});});
    for(const id of ids)await repo.removeBody(id);
    message(`已清理 ${ids.length} 篇普通文章。`);renderSettings(host,options);
  },report));cleanup.append(clear);
  activate(host.dataset.section||tabs[0]);
}
