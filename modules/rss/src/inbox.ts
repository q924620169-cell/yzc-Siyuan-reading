import {withWorkspaceLock,type Repository} from './storage';
import type {Kernel} from './kernel';
import type {RssService} from './service';
import type {InlBridge} from './bridge';
import {type Article,type ArticleBody} from './model';
import {markdownFromHtml} from './content';
import {translationPlan} from './translation-plan';
export type ChineseDocument=(article:Article,body:ArticleBody)=>Promise<{title:string;html:string}>;

const escape=(s:string)=>s.replace(/[\\`*_[\]<>]/g,'\\$&').replace(/\r?\n/g,' ');
export class Inbox {
  private tasks=new Map<string,Promise<string>>();
  constructor(private repo:Repository,private service:RssService,private api:Kernel,private bridge:()=>InlBridge|undefined,private persistCover?:(article:Article)=>Promise<string>,private chinese?:ChineseDocument){}
  import(article:Article):Promise<string>{
    const pending=this.tasks.get(article.id);if(pending)return pending;
    const job=withWorkspaceLock(`import:${article.id}`,async()=>{await this.repo.load();return this.run(article);}).finally(()=>this.tasks.delete(article.id));this.tasks.set(article.id,job);return job;
  }
  private async run(article:Article):Promise<string>{
    const bridge=this.bridge();if(!bridge)throw new Error('文档分类服务尚未就绪，请稍后重试。');
    const existing=this.repo.state.imports[article.id];
    if(existing?.completed && existing.documentId){
      // Verify that a real document still exists before reporting success.
      // The search index can lag behind creation. Verify the document directly.
      const attrs=await this.api<Record<string,string>>('/api/attr/getBlockAttrs',{id:existing.documentId});
      if(attrs?.['custom-yzc-rss-id']===article.id)return existing.documentId;
      throw new Error('此前导入的文档已删除或不可访问；已保留导入记录，未重复创建。');
    }
    const targets=await bridge.rootInboxTargets();
    const selected=this.repo.state.settings.inboxNotebook;
    const target=bridge.importTarget?await bridge.importTarget(existing?.notebook||selected):targets.find(t=>t.id===selected)||(!selected&&targets.length===1?targets[0]:undefined);
    if(!target)throw new Error('请先打开一个笔记本，再转入未分类。');
    if(existing?.documentId&&existing.language!=='zh-CN')throw new Error('发现此前未完成的旧版导入文档，未自动覆盖其内容。请先核对该文档。');
    const body=await this.service.read(article);
    article=this.repo.state.articles.find(a=>a.id===article.id)??article;
    let content:{title:string;html:string};
    if(this.chinese)content=await this.chinese(article,body);
    else{if((await translationPlan(article,body)).needed)throw new Error('中文译文尚未准备好，未创建 未分类文档。');content={title:article.title,html:body.html};}
    const source=this.repo.state.sources.find(s=>s.id===article.sourceId);
    const title=content.title.replace(/[\\/\r\n]/g,' ').trim().slice(0,180)||'RSS 文章';
    const path=existing?.path || `/RSS-${article.id.slice(0,24)}`;
    const notebook=existing?.notebook||target.id;
    if(bridge.importTarget&&existing?.notebook&&target.id!==existing.notebook)throw new Error('待完成导入的笔记本暂不可用，请打开原笔记本后重试。');
    if(!existing)await this.repo.update(s=>{s.imports[article.id]={notebook,path,language:'zh-CN'};});
    let coverAsset=existing?.coverAsset;
    if(!coverAsset&&(article.previewCover||article.cover)){
      if(!this.persistCover)throw new Error('题头图保存不可用，尚未完成导入。');
      coverAsset=await this.persistCover(article);
      const asset=coverAsset;await this.repo.update(s=>{s.imports[article.id].coverAsset=asset;});
    }
    const metadata=[
      [`原文：${article.url?`<${article.url}>`:'订阅未提供原文链接'}`,
      `来源：${escape(source?.title??'未知来源')}`,`作者：${escape(article.author||'未提供')}`,
      `发布时间：${article.published?new Date(article.published).toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'}):'发布时间未知'}`].map(line=>`> ${line}`).join('\n>\n'),
      markdownFromHtml(content.html,article.url||source?.url||''),
    ].join('\n\n');
    let id=existing?.documentId;
    if(!id){
      // Stable temporary path makes createDocWithMd retries idempotent, including a lost response.
      const ids=await this.api<string[]>('/api/filetree/getIDsByHPath',{notebook,path});
      if(ids[0]&&existing&&existing.language!=='zh-CN')throw new Error('发现旧版导入路径下已有文档，未覆盖正文或重复创建。');
      if(existing&&!ids[0]&&existing.language!=='zh-CN')await this.repo.update(s=>{s.imports[article.id].language='zh-CN';});
      id=ids[0] || await this.api<string>('/api/filetree/createDocWithMd',{notebook,path,markdown:metadata});
      if(!id)throw new Error('宿主未返回创建的文档 ID。');
      const createdId=id;
      await this.repo.update(s=>{s.imports[article.id].documentId=createdId;});
    }
    await this.api('/api/attr/setBlockAttrs',{id,attrs:{
      'custom-yzc-rss-id':article.id,'custom-yzc-rss-url':article.url,
      'custom-yzc-rss-source':source?.title??'','custom-yzc-rss-author':article.author,
      'custom-yzc-rss-published':article.published?new Date(article.published).toISOString():'',
      'custom-yzc-rss-content':body.kind,
      'custom-yzc-rss-language':'zh-CN',
      ...(coverAsset?{'title-img':`background-image: url("${coverAsset}"); background-position: 50% 60%;`}:{}),
    }});
    const location=await this.api<{notebook:string;path:string}>('/api/filetree/getPathByID',{id});
    if(location.notebook!==notebook || location.path.split('/').filter(Boolean).length!==1)
      throw new Error('已创建文档但目标核验失败，保留记录以避免重复导入。');
    await this.api('/api/filetree/renameDoc',{...location,title});
    const verified=await this.api<Record<string,string>>('/api/attr/getBlockAttrs',{id});
    if(verified['custom-yzc-rss-id']!==article.id)throw new Error('文档元数据核验失败，重试将继续原文档。');
    if(coverAsset&&!verified['title-img']?.includes(coverAsset))throw new Error('题头图关联核验失败，重试将继续原文档。');
    if(bridge.classifyImported)await bridge.classifyImported(id);
    else {
      await this.api('/api/attr/setBlockAttrs',{id,attrs:{'custom-inl-status':'inbox'}});
      const classified=await this.api<Record<string,string>>('/api/attr/getBlockAttrs',{id});
      if(classified['custom-inl-status']!=='inbox')throw Error('未分类状态核验失败，请重试。');
    }
    const documentId=id;
    await this.repo.update(s=>{
      s.imports[article.id]={notebook,path,documentId,coverAsset,completed:true,language:'zh-CN'};
      const a=s.articles.find(a=>a.id===article.id);if(a)a.importedId=documentId;
    });
    return documentId;
  }
}
