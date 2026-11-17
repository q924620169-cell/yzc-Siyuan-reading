import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {WeRead} from '../src/weread.js';
import {wereadMethods} from '../src/weread-ui.js';
import {readingMethods} from '../src/reading-ui.js';

test('private key persists independently of the feature switch and authentication result', async()=>{
 const previous=global.fetch;let stored={},requests=0;const key='wrk-settings-fixture';
 global.fetch=async(url,options)=>{
  if(url==='/api/file/getFile')return Response.json(stored);
  if(url==='/api/file/putFile'){assert.equal(options.body.get('path'),'/data/storage/petal/yzc-Siyuan-reading/reader/weread-account.json');stored=JSON.parse(await options.body.get('file').text());return Response.json({code:0});}
  throw Error('Unexpected endpoint');
 };
 try{
  const library={config:{weread:false}},client=new WeRead(library);
  await client.saveKey(key);assert.equal((await new WeRead(library).credentials()).key,key);assert.equal(stored.verification,'unverified');
  client.request=async()=>{requests++;throw Error('Untrusted response '+key);};
  assert.equal(await client.verifyKey(key),false);assert.equal(stored.verification,'failed');assert.equal(stored.key,key);assert(!JSON.stringify(stored).includes('Untrusted response'));
  client.request=async()=>{requests++;return{};};assert.equal(await client.verifyKey(key),true);assert.equal(stored.verification,'verified');
  await client.saveKey(key);assert.equal(stored.verification,'verified');assert.equal(library.config.weread,false);assert.equal(requests,2);
  let finish;client.request=()=>new Promise(resolve=>finish=resolve);const pending=client.verifyKey(key);await client.saveKey(key+'-new');finish({});await pending;assert.equal(stored.key,key+'-new');assert.equal(stored.verification,'unverified');
 }finally{global.fetch=previous;}
});

test('switches apply immediately while the inline key save is explicit and outside dismissal is safe',async()=>{
 const window=new JSDOM('<body></body>').window,old={document:global.document,getComputedStyle:global.getComputedStyle};
 global.document=window.document;global.getComputedStyle=window.getComputedStyle;
 window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
 let saved={key:'wrk-ui-fixture',verification:'verified'},writes=0,verifications=0;
 const ui={...readingMethods,...wereadMethods,wakeCursor(){},rememberSession(){},library:{config:{positionLock:true,autoHideCursor:true,weread:true},async saveConfig(){writes++;}},weread:{async credentials(){return saved;},async saveKey(key){saved={...saved,key};},async verifyKey(){verifications++;return true;}}};
 try{
  ui.settings();await new Promise(resolve=>setTimeout(resolve,0));
  let dialog=document.querySelector('dialog'),input=dialog.querySelector('input[type="password"]');assert.equal(input.value,saved.key);assert.equal(input.placeholder,'输入 Agent API Key');assert(!dialog.textContent.includes('微信读书增强'));assert(!dialog.textContent.includes('密钥仅保存在'));assert.equal(dialog.querySelectorAll('.yr-settings-group')[1].children.length,2);
  const reveal=dialog.querySelector('button[aria-label="显示密钥"]');reveal.click();assert.equal(input.type,'text');reveal.click();assert.equal(input.type,'password');
  assert.equal(dialog.querySelector('footer'),null);assert.equal(dialog.querySelectorAll('[aria-label="保存"]').length,1);assert.equal(dialog.querySelector('[aria-label="取消"]'),null);
  const toggle=dialog.querySelector('[aria-label="连接微信读书"]');toggle.checked=false;toggle.dispatchEvent(new window.Event('change'));assert.equal(ui.library.config.weread,false);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(writes,1);assert.equal(saved.key,'wrk-ui-fixture');
  input.value='wrk-ui-saved';input.dispatchEvent(new window.Event('input'));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(saved.key,'wrk-ui-fixture');
  dialog.querySelector('[aria-label="保存"]').click();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(saved.key,'wrk-ui-saved');assert(dialog.isConnected);assert.equal(verifications,0);
  input.value='wrk-ui-unsaved';input.dispatchEvent(new window.Event('input'));
  dialog.getBoundingClientRect=()=>({left:50,top:50,right:300,bottom:300});
  dialog.dispatchEvent(new window.MouseEvent('pointerdown',{clientX:100,clientY:100}));dialog.dispatchEvent(new window.MouseEvent('click',{clientX:100,clientY:100}));assert(dialog.isConnected);
  dialog.dispatchEvent(new window.MouseEvent('pointerdown',{clientX:10,clientY:10}));dialog.dispatchEvent(new window.MouseEvent('click',{clientX:10,clientY:10}));await new Promise(resolve=>setTimeout(resolve,0));assert(!document.querySelector('dialog'));assert.equal(input.value,'');assert.equal(saved.key,'wrk-ui-saved');
  ui.settings();await new Promise(resolve=>setTimeout(resolve,0));dialog=document.querySelector('dialog');assert.equal(dialog.querySelector('input[type="password"]').value,saved.key);assert.equal(dialog.querySelector('[aria-label="连接微信读书"]').checked,false);assert.equal(ui.library.config.positionLock,true);assert.equal(ui.library.config.autoHideCursor,true);const enabled=dialog.querySelector('[aria-label="连接微信读书"]');enabled.checked=true;enabled.dispatchEvent(new window.Event('change'));await new Promise(resolve=>setTimeout(resolve,0));assert.equal(verifications,1);assert.equal(dialog.querySelector('[role="status"]').textContent,'接口已验证');dialog.dispatchEvent(new window.Event('cancel'));

 }finally{global.document=old.document;global.getComputedStyle=old.getComputedStyle;window.close();}
});
