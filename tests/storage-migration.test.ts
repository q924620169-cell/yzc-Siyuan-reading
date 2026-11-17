import test from 'node:test';
import assert from 'node:assert/strict';
import { migratePluginStorage } from '../plugin/src/adapters/storage-migration';
const ROOT='/data/storage/petal',OLD=ROOT+'/yzc-INL-plus/',NEW=ROOT+'/yzc-INL/',MARKER=NEW+'identity-migration-v1.json';
const data={ 'settings.json':{schemaVersion:2,style:'anthropic',typography:'notion',inlSingleSection:true},'windows.json':{slots:[{id:'window-a',documentId:'doc-a'}],active:'window-a',history:[]},'inl-notebooks.json':{'notebook:book':{enabled:true,roles:{root:'library'}}} };
function host(){
  const files=new Map(Object.entries(data).map(([key,value])=>[OLD+key,JSON.stringify(value)]));const calls:{url:string;path:string}[]=[];let fail='';
  const request:typeof fetch=async(url,init)=>{
    init?.signal?.throwIfAborted();const endpoint=String(url);
    if(endpoint.endsWith('putFile')){
      const form=init!.body as FormData,path=String(form.get('path'));calls.push({url:endpoint,path});
      if(path===fail)return new Response(JSON.stringify({code:-1,msg:'write failed'}));
      files.set(path,await (form.get('file') as Blob).text());return new Response(JSON.stringify({code:0}));
    }
    const {path}=JSON.parse(String(init!.body));calls.push({url:endpoint,path});
    if(endpoint.endsWith('getFile'))return new Response(files.get(path)??JSON.stringify({code:404,msg:'not found',data:null}));
    const entries=new Map<string,{name:string;isDir:boolean}>();
    for(const file of files.keys())if(file.startsWith(path+'/')){const tail=file.slice(path.length+1),name=tail.split('/')[0];entries.set(name,{name,isDir:tail.includes('/')});}
    return new Response(JSON.stringify(entries.size?{code:0,data:[...entries.values()]}:{code:404,data:null}));
  };
  return {files,calls,request,setFailure:(path:string)=>{fail=path;}};
}
const run=(h:ReturnType<typeof host>,signal=new AbortController().signal)=>migratePluginStorage('yzc-INL',signal,h.request);
test('identity migration copies only three absent files, preserves source and is one-time/idempotent',async()=>{
  const h=host(),before=new Map(h.files);h.files.set(OLD+'unrelated.json','{"private":"unused"}');await run(h);
  for(const[key,value]of Object.entries(data))assert.deepEqual(JSON.parse(h.files.get(NEW+key)!),value);
  for(const[path,value]of before)assert.equal(h.files.get(path),value);
  assert.equal(h.files.has(NEW+'unrelated.json'),false);assert.equal(JSON.parse(h.files.get(MARKER)!).completed,true);
  const saved=new Map(h.files);h.calls.length=0;await run(h);assert.deepEqual(h.files,saved);
  assert(!h.calls.some(c=>c.path.startsWith(OLD)),'completed migration does not reread legacy storage');
  assert(h.calls.every(c=>['/api/file/readDir','/api/file/getFile','/api/file/putFile'].includes(c.url)));
});
test('existing destination settings, including intentional empty objects, are never overwritten or merged',async()=>{
  const h=host();h.files.set(NEW+'settings.json','{}');await run(h);assert.equal(h.files.get(NEW+'settings.json'),'{}');
  assert.deepEqual(JSON.parse(h.files.get(NEW+'windows.json')!),data['windows.json']);
});
test('invalid legacy JSON fails preflight without writing defaults or a completion marker',async()=>{
  const h=host();h.files.set(OLD+'windows.json','{broken');await assert.rejects(run(h));assert(![...h.files.keys()].some(p=>p.startsWith(NEW)));
  h.files.set(OLD+'windows.json',JSON.stringify(data['windows.json']));await run(h);assert(h.files.has(MARKER));
});
test('interrupted writes retry missing files without overwriting an already migrated destination',async()=>{
  const h=host();h.setFailure(NEW+'windows.json');await assert.rejects(run(h),/write failed/);assert(!h.files.has(MARKER));
  h.files.set(NEW+'settings.json','{"newUserPreference":true}');h.setFailure('');await run(h);
  assert.equal(h.files.get(NEW+'settings.json'),'{"newUserPreference":true}');assert(h.files.has(MARKER));
});
test('fresh install records completion; abort and non-target plugin IDs do not write storage',async()=>{
  const h=host();h.files.clear();await run(h);assert.equal(h.files.size,1);assert(h.files.has(MARKER));
  const other=host(),abort=new AbortController();abort.abort();await assert.rejects(run(other,abort.signal));assert.equal(other.calls.length,0);
  await migratePluginStorage('yzc-INL-plus',new AbortController().signal,other.request);assert.equal(other.calls.length,0);
});
