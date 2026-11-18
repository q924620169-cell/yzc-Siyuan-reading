import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';

const compiled=buildSync({entryPoints:['plugin/src/adapters/inbox-notebook.ts'],bundle:true,format:'cjs',platform:'node',external:['siyuan'],write:false}).outputFiles[0].text;
function fixture(){
  const notebooks=[{id:'other',name:'我的笔记本',closed:false}];
  const requests:{route:string;body:any}[]=[];
  const data=new Map<string,any>();
  const plugin={loadData:async(key:string)=>data.get(key),saveData:async(key:string,value:unknown)=>data.set(key,value)};
  const api=async(route:string,body:any)=>{
    requests.push({route,body});
    if(route.endsWith('lsNotebooks'))return {code:0,data:{notebooks}};
    if(route.endsWith('createNotebook')){
      const notebook={id:'created',name:body.name,closed:false};
      notebooks.push(notebook);return {code:0,data:{notebook}};
    }
    if(route.endsWith('openNotebook')){
      notebooks.find(n=>n.id===body.notebook)!.closed=false;return {code:0,data:null};
    }
    throw Error(route);
  };
  const mod={exports:{} as any};
  runInNewContext(compiled,{module:mod,exports:mod.exports,require:()=>({fetchSyncPost:api})});
  return {notebooks,requests,data,make:()=>new mod.exports.InboxNotebook(plugin)};
}

test('startup only detects an existing Inbox; concurrent first use creates one native notebook',async()=>{
  const f=fixture(),service=f.make();assert.equal(await service.find(),undefined);
  assert.equal(f.requests.length,1);
  const result=await Promise.all([service.ensure(),service.importTarget(),service.ensure()]);
  assert.ok(result.every(n=>n.id==='created'&&n.name==='未分类'));
  assert.equal(f.requests.filter(r=>r.route.endsWith('createNotebook')).length,1);
  assert.equal(f.data.get('inbox-notebook.json').id,'created');
  assert.equal((await f.make().ensure()).id,'created');
});

test('reuses an existing same-name notebook and follows its ID after rename',async()=>{
  const f=fixture(),service=f.make();const inbox={id:'native',name:'未分类',closed:true};
  f.notebooks.push(inbox);
  assert.equal((await service.find()).id,'native');assert.equal(inbox.closed,true);
  assert.equal((await service.ensure()).id,'native');assert.equal(inbox.closed,false);
  inbox.name='暂存';
  assert.equal((await f.make().importTarget()).id,'native');
  assert.equal(f.requests.filter(r=>r.route.endsWith('createNotebook')).length,0);
});

test('an interrupted old import stays at its recorded notebook and cannot silently restart elsewhere',async()=>{
  const f=fixture(),service=f.make();
  assert.equal((await service.importTarget('other')).id,'other');
  await assert.rejects(service.importTarget('missing'),/打开原笔记本/);
  f.notebooks[0].closed=true;await assert.rejects(service.importTarget('other'),/打开原笔记本/);
  assert.equal(f.requests.filter(r=>r.route.endsWith('createNotebook')).length,0);
});
