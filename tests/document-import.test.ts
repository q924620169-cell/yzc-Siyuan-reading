import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';

test('document import chooses usable legacy preference, single legacy target, home, then first open notebook',async()=>{
 const data=new Map<string,unknown>();let notebooks=[{id:'first',name:'一',closed:false},{id:'legacy',name:'旧',closed:false},{id:'home',name:'主页本',closed:false}],attrs:Record<string,string>={};let refreshed='';
 const output=await build({entryPoints:['plugin/src/adapters/document-import.ts'],bundle:true,format:'cjs',platform:'node',external:['siyuan'],write:false});const mod={exports:{} as any};
 const api=async(route:string,body:any)=>({code:0,data:route.endsWith('lsNotebooks')?{notebooks}:route.endsWith('getPathByID')?{notebook:'home'}:route.endsWith('getBlockAttrs')?attrs:(attrs={...attrs,...body.attrs})});
 runInNewContext(output.outputFiles[0].text,{module:mod,exports:mod.exports,require:()=>({fetchSyncPost:api})});
 const service=new mod.exports.DocumentImport({loadData:async(k:string)=>data.get(k)},async(id:string)=>{refreshed=id;});
 data.set('document-navigation.json',{homeId:'home-doc'});data.set('rss-inbox-targets.json',['legacy']);
 assert.equal((await service.target('home')).id,'home');assert.equal((await service.target('closed')).id,'legacy');
 data.set('rss-inbox-targets.json',['first','legacy']);assert.equal((await service.target()).id,'home');
 data.delete('document-navigation.json');assert.equal((await service.target()).id,'first');
 data.delete('rss-inbox-targets.json');data.set('inl-notebooks.json',{'notebook:legacy':{roles:{root:'inbox'}}});assert.equal((await service.target()).id,'legacy');
 await service.classify('new-doc');assert.equal(attrs['custom-inl-status'],'inbox');assert.equal(refreshed,'new-doc');
 notebooks=notebooks.map(n=>({...n,closed:true}));await assert.rejects(service.target(),/先打开一个笔记本/);
});

test('deleted home falls back; closed home notebook falls back; other host failures stay visible',async()=>{
 const data=new Map<string,unknown>([['document-navigation.json',{homeId:'deleted-home'}]]);let pathResult:any={code:-1,msg:'block not found'};
 const output=await build({entryPoints:['plugin/src/adapters/document-import.ts'],bundle:true,format:'cjs',platform:'node',external:['siyuan'],write:false});const mod={exports:{} as any};
 runInNewContext(output.outputFiles[0].text,{module:mod,exports:mod.exports,require:()=>({fetchSyncPost:async(route:string)=>route.endsWith('lsNotebooks')?{code:0,data:{notebooks:[{id:'closed',name:'关闭',closed:true},{id:'open',name:'已打开',closed:false}]}}:pathResult})});
 const service=new mod.exports.DocumentImport({loadData:async(k:string)=>data.get(k)});
 assert.equal((await service.target()).id,'open');
 pathResult={code:0,data:{notebook:'closed'}};assert.equal((await service.target()).id,'open');
 pathResult={code:404,msg:'not found'};assert.equal((await service.target()).id,'open');
 for(const [code,msg]of [[403,'permission denied'],[-1,'document metadata is not ready'],[500,'internal server error']]){pathResult={code,msg};await assert.rejects(service.target(),new RegExp(msg as string));}
});
