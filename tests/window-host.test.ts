import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {runInNewContext} from 'node:vm';
import {JSDOM} from 'jsdom';

test('an Editor with no loaded rootID remains an Editor; only actual tool tabs restore native navigation',()=>{
  const dom=new JSDOM('<li></li>');
  let tab:any={id:'editor-loading',model:{},headElement:dom.window.document.querySelector('li')};
  let editors=[tab];
  const output=buildSync({entryPoints:['plugin/src/adapters/window-host.ts'],bundle:true,format:'cjs',platform:'node',external:['siyuan'],write:false});
  const mod={exports:{} as any};
  runInNewContext(output.outputFiles[0].text,{module:mod,exports:mod.exports,require:()=>({getActiveTab:()=>tab,getAllEditor:()=>[],getAllTabs:(type?:string)=>type==='Editor'?editors:[tab]})});
  const host=mod.exports.windowHost({});
  assert.equal(host.active(),undefined,'rootID is not loaded yet');
  assert.equal(host.foreign(),false,'loading an Editor must not expose a native tab row');
  editors=[];tab={...tab,id:'plugin-tool'};
  assert.equal(host.foreign(),true);
  tab={...tab,model:undefined};tab.headElement.setAttribute('data-initdata',JSON.stringify({instance:'Editor',rootId:'doc'}));
  assert.equal(host.foreign(),false,'restored but unloaded Editor');
  tab.headElement.setAttribute('data-initdata',JSON.stringify({instance:'Custom'}));
  assert.equal(host.foreign(),true);
  dom.window.close();
});
