import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateModules} from '../shared/storage-migration';

test('module state migration resumes an interrupted copy, keeps new files and all legacy bytes',async()=>{
  const root='/data/storage/petal',files=new Map<string,Uint8Array>();
  const put=(p:string,s:string)=>files.set(root+p,new TextEncoder().encode(s));
  put('/yzc-Reader/config.json','{"avID":"unchanged","docID":"same","lists":["旧书单"]}');
  put('/yzc-Reader/books/book/reading.json','{"bookmarks":[1],"annotations":[2],"location":{"cfi":"stable"}}');
  put('/yzc-Reader/weread-account.json','{"key":"private-fixture"}');
  put('/yzc-RSS/state.json','{"sources":[1],"imports":{"old":{"completed":true,"documentId":"original"}}}');
  put('/yzc-RSS/images/cover.bin','binary\u0000image');
  put('/yzc-INL/reader/config.json','{"avID":"new-wins"}');
  const legacy=[...files].filter(([p])=>!p.includes('/yzc-INL/')).map(([p,b])=>[p,Buffer.from(b).toString('hex')]);
  let writes=0,fail=true;
  const request:typeof fetch=async(url,options)=>{
    if(String(url).endsWith('/putFile')){
      const form=options!.body as FormData,p=String(form.get('path'));
      if(fail&&++writes===2)throw Error('interrupted');
      files.set(p,new Uint8Array(await (form.get('file') as Blob).arrayBuffer()));return Response.json({code:0});
    }
    const {path}=JSON.parse(options!.body as string);
    if(String(url).endsWith('/getFile'))return files.has(path)?new Response(files.get(path)! as BodyInit):Response.json({code:404},{status:404});
    if(String(url).endsWith('/readDir')){
      const entries=new Map<string,boolean>();
      for(const p of files.keys())if(p.startsWith(path+'/')){const tail=p.slice(path.length+1),name=tail.split('/')[0];entries.set(name,tail.includes('/'));}
      return Response.json(entries.size?{code:0,data:[...entries].map(([name,isDir])=>({name,isDir}))}:{code:404});
    }
    throw Error(String(url));
  };
  await assert.rejects(migrateModules(new AbortController().signal,request),/interrupted/);
  assert(!files.has(root+'/yzc-INL/modules-migration-v1.json'));
  fail=false;await migrateModules(new AbortController().signal,request);
  assert.equal(new TextDecoder().decode(files.get(root+'/yzc-INL/reader/config.json')),'{"avID":"new-wins"}');
  for(const [p,hex] of legacy){assert.equal(Buffer.from(files.get(p!)!).toString('hex'),hex);const target=p!.replace('/yzc-Reader/','/yzc-INL/reader/').replace('/yzc-RSS/','/yzc-INL/rss/');if(!p!.endsWith('/config.json'))assert.deepEqual(files.get(target),files.get(p!));}
  const snapshot=[...files.keys()];await migrateModules(new AbortController().signal,request);assert.deepEqual([...files.keys()],snapshot);
});
