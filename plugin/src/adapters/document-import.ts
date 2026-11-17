import type {Plugin} from 'siyuan';
import {kernel} from './document-attribute-adapter';
import {STATUS_ATTRIBUTE} from '../inl/inl-status';

/** Shared document classification and placement service for RSS imports. */
export class DocumentImport {
  constructor(private plugin:Plugin,private refresh:(id:string)=>Promise<void> = async()=>{}){}
  async target(preferred?:string):Promise<{id:string;name:string}>{
    const {notebooks}=await kernel<{notebooks:{id:string;name:string;closed:boolean}[]}>('/api/notebook/lsNotebooks',{});
    const available=notebooks.filter(n=>!n.closed);
    if(!available.length)throw Error('请先打开一个笔记本，再转入未分类。');
    if(preferred){const chosen=available.find(n=>n.id===preferred);if(chosen)return chosen;}
    const ids=await this.plugin.loadData('rss-inbox-targets.json');
    let legacy:string[];
    if(Array.isArray(ids))legacy=ids;
    else {
      const roles=await this.plugin.loadData('inl-notebooks.json')||{};
      legacy=available.filter(n=>roles[`notebook:${n.id}`]?.roles?.root==='inbox').map(n=>n.id);
    }
    const oldTargets=available.filter(n=>legacy.includes(n.id));
    if(oldTargets.length===1)return oldTargets[0];
    const nav=await this.plugin.loadData('document-navigation.json')||{};
    if(nav.homeId){
      const location=await kernel<{notebook:string}>('/api/filetree/getPathByID',{id:nav.homeId});
      const home=available.find(n=>n.id===location.notebook);if(home)return home;
    }
    return available[0];
  }
  async classify(id:string):Promise<void>{
    await kernel('/api/attr/setBlockAttrs',{id,attrs:{[STATUS_ATTRIBUTE]:'inbox'}});
    const attrs=await kernel<Record<string,string>>('/api/attr/getBlockAttrs',{id});
    if(attrs[STATUS_ATTRIBUTE]!=='inbox')throw Error('未分类状态保存失败，请重试。');
    await this.refresh(id);
  }
}
