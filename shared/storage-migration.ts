const ROOT='/data/storage/petal';
type Entry={name:string;isDir:boolean};

/** Copy only missing state files. Original assets, database IDs and sources stay intact. */
export async function migrateModules(signal:AbortSignal,request:typeof fetch=fetch):Promise<void>{
  const run=async()=>{
    const json=async(route:string,body:unknown)=>{
      signal.throwIfAborted();
      const r=await request(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
      if(!r.ok&&r.status!==404)throw Error(`迁移读取失败：${route} (${r.status})`);
      return r.status===404?{code:404}:r.json();
    };
    const list=async(path:string):Promise<Entry[]>=>{
      const r=await json('/api/file/readDir',{path});
      if(r.code===404)return [];
      if(r.code!==0||!Array.isArray(r.data))throw Error(r.msg||'无法读取迁移目录');
      for(const e of r.data)if(!e.name||e.name==='.'||e.name==='..'||/[\\/]/.test(e.name))throw Error('非法迁移文件名');
      return r.data;
    };
    const read=async(path:string)=>{
      const r=await request('/api/file/getFile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path}),signal});
      if(!r.ok)throw Error(`无法读取迁移文件：${path}`);
      return new Uint8Array(await r.arrayBuffer());
    };
    const hash=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)),n=>n.toString(16).padStart(2,'0')).join('');
    const write=async(path:string,bytes:Uint8Array)=>{
      signal.throwIfAborted();
      const form=new FormData();form.append('path',path);form.append('file',new Blob([bytes as BlobPart]),path.split('/').pop()!);
      const r=await request('/api/file/putFile',{method:'POST',body:form,signal});
      if(!r.ok)throw Error(`迁移保存失败：${path}`);
      const data=await r.json();if(data.code!==0)throw Error(data.msg||'迁移保存失败');
      if(await hash(bytes)!==await hash(await read(path)))throw Error(`迁移校验失败：${path}`);
    };
    const copy=async(from:string,to:string):Promise<void>=>{
      const entries=await list(from),dest=await list(to);
      for(const e of entries){
        const prior=dest.find(d=>d.name===e.name);
        if(prior&&prior.isDir!==e.isDir)throw Error(`迁移路径冲突：${to}/${e.name}`);
        if(e.isDir)await copy(`${from}/${e.name}`,`${to}/${e.name}`);
        else if(!prior){
          const bytes=await read(`${from}/${e.name}`);
          if(e.name.endsWith('.json'))JSON.parse(new TextDecoder().decode(bytes));
          await write(`${to}/${e.name}`,bytes);
        }
      }
    };
    const marker='modules-migration-v1.json',destination=`${ROOT}/yzc-INL`;
    if((await list(destination)).some(e=>e.name===marker)){
      const done=JSON.parse(new TextDecoder().decode(await read(`${destination}/${marker}`)));
      if(done.version===1&&done.completed===true)return;
      throw Error('模块迁移记录无效');
    }
    await copy(`${ROOT}/yzc-Reader`,`${destination}/reader`);
    await copy(`${ROOT}/yzc-RSS`,`${destination}/rss`);
    await write(`${destination}/${marker}`,new TextEncoder().encode(JSON.stringify({version:1,completed:true,from:['yzc-Reader','yzc-RSS']})));
  };
  if(globalThis.navigator?.locks)await navigator.locks.request('yzc-INL:modules-migration-v1',{signal},run);
  else await run();
}
