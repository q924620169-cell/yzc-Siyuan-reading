const ROOT='/data/storage/petal';
type Entry={name:string;isDir:boolean};

/** Verify staging bytes before a no-overwrite rename. Keep valid new data and all legacy sources. */
export async function migrateModules(signal:AbortSignal,request:typeof fetch=fetch):Promise<void>{
  const run=async()=>{
    const marker='reading-id-migration-v1.json',destination=`${ROOT}/yzc-Siyuan-reading`;
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
    const validate=(path:string,bytes:Uint8Array)=>{
      if(path.endsWith('.json')){
        const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        if(path===`${destination}/${marker}`&&(value?.version!==1||value?.to!=='yzc-Siyuan-reading'||value?.completed!==true))throw Error('模块迁移记录无效');
      }
    };
    const existing=async(path:string)=>{
      const slash=path.lastIndexOf('/'),entry=(await list(path.slice(0,slash))).find(e=>e.name===path.slice(slash+1));
      if(!entry)return undefined;
      if(entry.isDir)throw Error(`迁移路径冲突：${path}`);
      const bytes=await read(path);
      try{validate(path,bytes);return{bytes,valid:true};}catch{return{bytes,valid:false};}
    };
    const rename=async(path:string,newPath:string)=>{
      const result=await json('/api/file/renameFile',{path,newPath});
      if(result.code!==0)throw Error(result.msg||`迁移重命名失败：${path}`);
    };
    const write=async(path:string,bytes:Uint8Array)=>{
      validate(path,bytes);
      signal.throwIfAborted();
      const staged=path+'.inl-migration-v2.tmp';
      const form=new FormData();form.append('path',staged);form.append('file',new Blob([bytes as BlobPart]),staged.split('/').pop()!);
      const r=await request('/api/file/putFile',{method:'POST',body:form,signal});
      if(!r.ok)throw Error(`迁移保存失败：${path}`);
      const data=await r.json();if(data.code!==0)throw Error(data.msg||'迁移保存失败');
      if(await hash(bytes)!==await hash(await read(staged)))throw Error(`迁移临时文件校验失败：${path}`);
      // Recheck after staging: a valid destination always wins, including a file
      // created by another frontend while this request was in flight.
      const prior=await existing(path);
      if(prior?.valid)return;
      if(prior)await rename(path,path+'.inl-invalid-'+crypto.randomUUID()+'.bak');
      await rename(staged,path);
      if(await hash(bytes)!==await hash(await read(path)))throw Error(`迁移校验失败：${path}`);
    };
    const candidates=new Map<string,string[]>();
    const collect=async(from:string,to:string):Promise<void>=>{
      const entries=await list(from);
      for(const e of entries){
        if(e.name===marker||e.name.endsWith('.inl-migration-v2.tmp')||/\.inl-invalid-.+\.bak$/.test(e.name))continue;
        if(e.isDir)await collect(`${from}/${e.name}`,`${to}/${e.name}`);
        else {const target=`${to}/${e.name}`;candidates.set(target,[...(candidates.get(target)||[]),`${from}/${e.name}`]);}
      }
    };
    // This marker belongs to the new installation identity. Old INL module
    // markers are compatibility data, never proof that this copy completed.
    if((await existing(`${destination}/${marker}`))?.valid)return;
    await collect(`${ROOT}/yzc-INL`,destination);
    await collect(`${ROOT}/yzc-Reader`,`${destination}/reader`);
    await collect(`${ROOT}/yzc-RSS`,`${destination}/rss`);
    for(const [target,sources]of candidates){
      if((await existing(target))?.valid)continue;
      let bytes:Uint8Array|undefined;
      for(const source of sources){
        const candidate=await read(source);
        try{validate(target,candidate);bytes=candidate;break;}catch{/* Keep malformed sources untouched; try the lower-priority legacy copy. */}
      }
      if(!bytes)throw Error(`没有可恢复的有效迁移来源：${target}`);
      await write(target,bytes);
    }
    await write(`${destination}/${marker}`,new TextEncoder().encode(JSON.stringify({version:1,to:'yzc-Siyuan-reading',completed:true,from:['yzc-INL','yzc-Reader','yzc-RSS']})));
  };
  if(globalThis.navigator?.locks)await navigator.locks.request('yzc-Siyuan-reading:identity-migration-v1',{signal},run);
  else await run();
}
