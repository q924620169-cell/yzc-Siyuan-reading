import {canonicalUrl} from './model';
import type {DataIO} from './storage';

export type Kernel=<T>(path:string,body:Record<string,unknown>,requestSignal?:AbortSignal)=>Promise<T>;
export function kernelClient(signal?:AbortSignal):Kernel {
  return async <T>(path:string,body:Record<string,unknown>,requestSignal?:AbortSignal):Promise<T>=>{
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal&&requestSignal?AbortSignal.any([signal,requestSignal]):requestSignal??signal});
    if(!response.ok)throw new Error(`思源请求失败：HTTP ${response.status}`);
    const result=await response.json() as {code:number;msg:string;data:T};
    if(result.code!==0)throw new Error(result.msg||'思源请求失败');
    return result.data;
  };
}
export interface Remote {status:number;body:string;headers:Record<string,string[]>;url?:string}
export class RemoteClient {
  constructor(private api:Kernel){}
  async get(url:string,headers:Record<string,string>={},binary=false,signal?:AbortSignal):Promise<Remote>{
    if(!canonicalUrl(url))throw new Error('只支持不含用户名密码的 HTTP(S) 地址。');
    const result=await this.api<Remote>('/api/network/forwardProxy',{
      url,method:'GET',timeout:15000,headers:[{...headers,'User-Agent':'yzc-RSS/0.1 (SiYuan RSS reader)'}],
      payload:'',responseEncoding:binary?'base64':'text',
    },signal);
    if(result.status!==304 && (result.status<200 || result.status>=300))throw new Error(`来源请求失败：HTTP ${result.status}`);
    if(typeof result.body!=='string' || result.body.length>(binary?12_000_000:8_000_000))throw new Error('来源内容超过大小上限。');
    return result;
  }
}
export function header(response:Remote,name:string):string|undefined{
  const value=Object.entries(response.headers??{}).find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1];
  return Array.isArray(value)?value[0]:typeof value==='string'?value:undefined;
}
export async function removeFile(api:Kernel,path:string):Promise<void>{
  try{await api('/api/file/removeFile',{path});}
  catch(error){
    // SiYuan 3.8.7 reports already absent paths as an error, not an empty success.
    if(!(error instanceof Error)||error.message!=='path does not exist')throw error;
  }
}
/** Official file API with explicit errors; never treat a failed read as empty data. */
export function pluginDataIO(signal:AbortSignal):DataIO{
  const path=(name:string)=>{
    if(!/^[a-zA-Z0-9_.-]+$/.test(name))throw new Error('非法数据文件名');
    return `/data/storage/petal/yzc-INL/rss/${name}`;
  };
  return{
    load:async name=>{
      const response=await fetch('/api/file/getFile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:path(name)}),signal});
      if(response.status===404)return undefined;
      if(!response.ok)throw new Error(`RSS 数据读取失败：${response.status}`);
      const data=await response.json();
      if(data?.code===404)return undefined;
      if(typeof data?.code==='number' && data.code!==0)throw new Error(data.msg||'RSS 数据读取失败');
      return data;
    },
    save:async(name,data)=>{
      const form=new FormData();form.append('path',path(name));form.append('file',new Blob([JSON.stringify(data)],{type:'application/json'}),name);
      const response=await fetch('/api/file/putFile',{method:'POST',body:form,signal});
      if(!response.ok)throw new Error(`RSS 数据保存失败：${response.status}`);
      const result=await response.json();if(result.code!==0)throw new Error(result.msg||'RSS 数据保存失败');
    },
    remove:async name=>removeFile(kernelClient(signal),path(name)),
  };
}
