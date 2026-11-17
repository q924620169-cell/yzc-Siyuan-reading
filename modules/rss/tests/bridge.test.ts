import {dom} from './environment';
import test from 'node:test';
import assert from 'node:assert/strict';
import {BridgeClient,type InlBridge,type ToolWindow} from '../src/bridge';

test('INL dependency supports both startup orders, hides on disable, ignores stale offline events and cleans listeners',()=>{
  const nativeController=globalThis.AbortController;
  globalThis.AbortController=dom.window.AbortController as typeof AbortController;
  const available:boolean[]=[],calls:string[]=[];
  const tool:ToolWindow={id:'yzc-RSS',title:'RSS',isActive:()=>false,
    open:async()=>{},close:()=>calls.push('close'),active:v=>calls.push(`active:${v}`),reselect:()=>{}};
  const bridge:InlBridge={version:1,register:()=>{calls.push('register');return()=>calls.push('unregister');},
    open:id=>calls.push(`open:${id}`),close:()=>{},rootInboxTargets:async()=>[]};
  const ready=(b=bridge)=>document.dispatchEvent(new CustomEvent('yzc-inl:bridge-ready',{detail:b}));
  const offline=(b=bridge)=>document.dispatchEvent(new CustomEvent('yzc-inl:bridge-offline',{detail:b}));
  const request=(e:Event)=>(e as CustomEvent).detail.accept(bridge);
  let client:BridgeClient|undefined;
  try{
    client=new BridgeClient(tool,v=>available.push(v));client.connect();client.open();
    assert.deepEqual(available,[false]);assert.deepEqual(calls,[]);
    ready();ready();client.open();
    assert.deepEqual(available,[false,true]);assert.deepEqual(calls,['register','open:yzc-RSS']);
    offline({...bridge});assert.equal(client.current,bridge);
    offline();assert.equal(client.current,undefined);assert.equal(available.at(-1),false);
    assert.deepEqual(calls.slice(-2),['active:false','close']);
    ready();assert.equal(available.at(-1),true);
    client.dispose();const n=available.length;ready();offline();assert.equal(available.length,n);
    document.addEventListener('yzc-inl:bridge-request',request);
    client=new BridgeClient(tool,v=>available.push(v));client.connect();
    assert.equal(client.current,bridge);assert.equal(available.at(-1),true);
  }finally{
    client?.dispose();document.removeEventListener('yzc-inl:bridge-request',request);
    globalThis.AbortController=nativeController;
  }
});
