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
  put('/yzc-Siyuan-reading/reader/config.json','{"avID":"new-wins"}');
  const legacy=[...files].filter(([p])=>!p.includes('/yzc-Siyuan-reading/')).map(([p,b])=>[p,Buffer.from(b).toString('hex')]);
  let writes=0,fail=true;
  const request:typeof fetch=async(url,options)=>{
    if(String(url).endsWith('/putFile')){
      const form=options!.body as FormData,p=String(form.get('path'));
      if(fail&&++writes===2)throw Error('interrupted');
      files.set(p,new Uint8Array(await (form.get('file') as Blob).arrayBuffer()));return Response.json({code:0});
    }
    const {path}=JSON.parse(options!.body as string);
    if(String(url).endsWith('/renameFile')){
      const {newPath}=JSON.parse(options!.body as string);
      if(files.has(newPath))return Response.json({code:409,msg:'path already exists'});
      assert(files.has(path));files.set(newPath,files.get(path)!);files.delete(path);return Response.json({code:0});
    }
    if(String(url).endsWith('/getFile'))return files.has(path)?new Response(files.get(path)! as BodyInit):Response.json({code:404},{status:404});
    if(String(url).endsWith('/readDir')){
      const entries=new Map<string,boolean>();
      for(const p of files.keys())if(p.startsWith(path+'/')){const tail=p.slice(path.length+1),name=tail.split('/')[0];entries.set(name,tail.includes('/'));}
      return Response.json(entries.size?{code:0,data:[...entries].map(([name,isDir])=>({name,isDir}))}:{code:404});
    }
    throw Error(String(url));
  };
  await assert.rejects(migrateModules(new AbortController().signal,request),/interrupted/);
  assert(!files.has(root+'/yzc-Siyuan-reading/reading-id-migration-v1.json'));
  fail=false;await migrateModules(new AbortController().signal,request);
  assert.equal(new TextDecoder().decode(files.get(root+'/yzc-Siyuan-reading/reader/config.json')),'{"avID":"new-wins"}');
  for(const [p,hex] of legacy){assert.equal(Buffer.from(files.get(p!)!).toString('hex'),hex);const target=p!.replace('/yzc-Reader/','/yzc-Siyuan-reading/reader/').replace('/yzc-RSS/','/yzc-Siyuan-reading/rss/');if(!p!.endsWith('/config.json'))assert.deepEqual(files.get(target),files.get(p!));}
  const snapshot=[...files.keys()];await migrateModules(new AbortController().signal,request);assert.deepEqual([...files.keys()],snapshot);
});

function migrationDisk(){
 const files=new Map<string,Uint8Array>();
 const writes:string[]=[],renames:{path:string;newPath:string}[]=[];
 const disk={files,writes,renames,afterWrite:undefined as undefined|((path:string)=>void),afterRename:undefined as undefined|((path:string,newPath:string)=>void)};
 const request:typeof fetch=async(url,options)=>{
  if(String(url).endsWith('/putFile')){const form=options!.body as FormData,path=String(form.get('path'));writes.push(path);files.set(path,new Uint8Array(await(form.get('file') as Blob).arrayBuffer()));disk.afterWrite?.(path);return Response.json({code:0});}
  const {path,newPath}=JSON.parse(options!.body as string);
  if(String(url).endsWith('/getFile'))return files.has(path)?new Response(files.get(path)! as BodyInit):Response.json({code:404},{status:404});
  if(String(url).endsWith('/renameFile')){if(files.has(newPath))return Response.json({code:409,msg:'path already exists'});assert(files.has(path));renames.push({path,newPath});files.set(newPath,files.get(path)!);files.delete(path);disk.afterRename?.(path,newPath);return Response.json({code:0});}
  if(String(url).endsWith('/readDir')){const entries=new Map<string,boolean>();for(const p of files.keys())if(p.startsWith(path+'/')){const tail=p.slice(path.length+1);entries.set(tail.split('/')[0],tail.includes('/'));}return Response.json(entries.size?{code:0,data:[...entries].map(([name,isDir])=>({name,isDir}))}:{code:404});}
  throw Error(String(url));
 };
 return Object.assign(disk,{request,put:(p:string,text:string)=>files.set(p,new TextEncoder().encode(text)),text:(p:string)=>new TextDecoder().decode(files.get(p))});
}
const ROOT='/data/storage/petal',source=ROOT+'/yzc-RSS/state.json',target=ROOT+'/yzc-Siyuan-reading/rss/state.json',marker=ROOT+'/yzc-Siyuan-reading/reading-id-migration-v1.json';
test('a successful API response with corrupted staging bytes never publishes data or a completion marker; retry repairs it',async()=>{
 const disk=migrationDisk();disk.put(source,'{"version":2,"sources":["kept"]}');
 disk.afterWrite=path=>{if(path===target+'.inl-migration-v2.tmp')disk.put(path,'broken JSON');};
 await assert.rejects(migrateModules(new AbortController().signal,disk.request),/临时文件校验失败/);
 assert(!disk.files.has(target));assert(!disk.files.has(marker));assert.equal(disk.renames.length,0);
 disk.afterWrite=undefined;await migrateModules(new AbortController().signal,disk.request);
 assert.equal(disk.text(target),disk.text(source));assert(JSON.parse(disk.text(marker)).completed);
 assert(disk.writes.every(p=>p.endsWith('.inl-migration-v2.tmp')));
});
test('v1 completion cannot hide bad destination JSON; preserve a backup and keep unrelated valid new data',async()=>{
 const disk=migrationDisk();disk.put(source,'{"version":2,"sources":["legacy"]}');disk.put(target,'{damaged');
 disk.put(ROOT+'/yzc-Siyuan-reading/modules-migration-v1.json','{"version":1,"completed":true}');
 disk.put(ROOT+'/yzc-Reader/config.json','{"avID":"old"}');disk.put(ROOT+'/yzc-Siyuan-reading/reader/config.json','{"avID":"new-wins"}');
 await migrateModules(new AbortController().signal,disk.request);
 assert.equal(disk.text(target),disk.text(source));
 const backup=[...disk.files.keys()].find(p=>p.startsWith(target+'.inl-invalid-')&&p.endsWith('.bak'));assert(backup);assert.equal(disk.text(backup),'{damaged');
 assert.equal(disk.text(ROOT+'/yzc-Siyuan-reading/reader/config.json'),'{"avID":"new-wins"}');
 assert.equal(JSON.parse(disk.text(marker)).version,1);
});
test('a lost rename response retries the same published file without rewriting valid data',async()=>{
 const disk=migrationDisk();disk.put(source,'{"version":2}');let lost=true;
 disk.afterRename=(_path,newPath)=>{if(newPath===target&&lost){lost=false;throw Error('response lost');}};
 await assert.rejects(migrateModules(new AbortController().signal,disk.request),/response lost/);assert(!disk.files.has(marker));
 await migrateModules(new AbortController().signal,disk.request);
 assert.equal(disk.renames.filter(r=>r.newPath===target).length,1);assert.equal(disk.text(target),disk.text(source));
});
test('valid destination created during staging wins and invalid legacy data is never promoted',async()=>{
 const disk=migrationDisk();disk.put(source,'{"version":2}');disk.afterWrite=path=>{if(path===target+'.inl-migration-v2.tmp')disk.put(target,'{"version":2,"newUserData":true}');};
 await migrateModules(new AbortController().signal,disk.request);assert(JSON.parse(disk.text(target)).newUserData);assert(!disk.renames.some(r=>r.newPath===target));
 const invalid=migrationDisk();invalid.put(source,'{broken');await assert.rejects(migrateModules(new AbortController().signal,invalid.request));assert(!invalid.files.has(target));assert(!invalid.files.has(marker));
});

test('new identity keeps valid new data, then prefers merged INL data and only fills missing standalone files',async()=>{
 const disk=migrationDisk();
 disk.put(ROOT+'/yzc-INL/settings.json','{"style":"anthropic"}');
 disk.put(ROOT+'/yzc-INL/navigation-order.json','{"spaces":["yzc-RSS","document","yzc-Reader"]}');
 disk.put(ROOT+'/yzc-INL/reader/config.json','{"avID":"same-library","lists":["merged"]}');
 disk.put(ROOT+'/yzc-Reader/config.json','{"avID":"older-library"}');
 disk.put(ROOT+'/yzc-Reader/books/book/reading.json','{"bookmarks":["legacy-position"]}');
 disk.put(ROOT+'/yzc-INL/rss/state.json','{"version":2,"sources":["merged"]}');
 disk.put(source,'{"version":2,"sources":["standalone"]}');
 disk.put(ROOT+'/yzc-Siyuan-reading/settings.json','{"style":"notion","newUserData":true}');
 disk.put(ROOT+'/yzc-INL/modules-migration-v1.json','{"version":1,"completed":true}');
 disk.put(ROOT+'/yzc-INL/modules-migration-v2.json','{"version":2,"completed":true}');
 const originals=[...disk.files].map(([p,b])=>[p,Buffer.from(b).toString('hex')]);
 await migrateModules(new AbortController().signal,disk.request);
 assert(JSON.parse(disk.text(ROOT+'/yzc-Siyuan-reading/settings.json')).newUserData);
 assert.equal(JSON.parse(disk.text(ROOT+'/yzc-Siyuan-reading/reader/config.json')).avID,'same-library');
 assert.equal(disk.text(target),disk.text(ROOT+'/yzc-INL/rss/state.json'));
 assert.equal(disk.text(ROOT+'/yzc-Siyuan-reading/reader/books/book/reading.json'),disk.text(ROOT+'/yzc-Reader/books/book/reading.json'));
 assert.equal(disk.text(ROOT+'/yzc-Siyuan-reading/navigation-order.json'),disk.text(ROOT+'/yzc-INL/navigation-order.json'));
 assert.equal(JSON.parse(disk.text(marker)).to,'yzc-Siyuan-reading');
 for(const [p,hex]of originals)assert.equal(Buffer.from(disk.files.get(p)!).toString('hex'),hex);
});
test('a malformed old merged JSON source falls back to a valid standalone copy without changing the old source',async()=>{
 const disk=migrationDisk();disk.put(ROOT+'/yzc-INL/rss/state.json','{old bad copy');disk.put(source,'{"version":2,"sources":["recover"]}');
 await migrateModules(new AbortController().signal,disk.request);
 assert.equal(disk.text(target),disk.text(source));assert.equal(disk.text(ROOT+'/yzc-INL/rss/state.json'),'{old bad copy');
});
test('a completion marker found in a legacy directory is never copied as proof for the new identity',async()=>{
 const disk=migrationDisk();disk.put(ROOT+'/yzc-INL/reading-id-migration-v1.json','{"version":1,"to":"yzc-Siyuan-reading","completed":true}');disk.put(ROOT+'/yzc-INL/rss/state.json','{"version":2}');
 disk.afterWrite=p=>{if(p===target+'.inl-migration-v2.tmp')disk.put(p,'{bad');};
 await assert.rejects(migrateModules(new AbortController().signal,disk.request),/临时文件校验失败/);assert(!disk.files.has(marker));
});

test('damaged or incomplete new-identity markers are backed up and retried without replacing valid user data',async()=>{
 for(const damaged of ['{broken','{"version":1,"to":"yzc-Siyuan-reading","completed":false}']){
  const disk=migrationDisk();disk.put(source,'{"version":2,"sources":["old"]}');disk.put(target,'{"version":2,"sources":["new"]}');disk.put(marker,damaged);
  await migrateModules(new AbortController().signal,disk.request);
  assert.equal(disk.text(target),'{"version":2,"sources":["new"]}');assert(JSON.parse(disk.text(marker)).completed);
  const backup=[...disk.files.keys()].find(p=>p.startsWith(marker+'.inl-invalid-')&&p.endsWith('.bak'));assert(backup);assert.equal(disk.text(backup),damaged);
 }
});
