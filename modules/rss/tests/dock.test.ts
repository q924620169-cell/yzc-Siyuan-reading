import {dom} from './environment';
import test from 'node:test';
import assert from 'node:assert/strict';
import {DockNavigation} from '../src/host';

test('RSS activity toggles the native sidebar without reopening or resetting the reader',()=>{
  document.body.innerHTML='<div id="dockLeft"><button data-type="file" class="dock__item--active"></button><button data-type="yzc-RSSnavigation"></button></div><aside></aside>';
  const pane=document.querySelector('aside')!,calls:string[]=[];
  let visible=true,opens=0;
  pane.getBoundingClientRect=()=>({width:visible?304:0} as DOMRect);
  const dock={layout:{element:pane},panelVisible:true,
    toggleModel(type:string,show?:boolean,close?:boolean){
      calls.push(`${type}:${show}:${close}`);
      document.querySelectorAll('#dockLeft button').forEach(b=>b.classList.toggle('dock__item--active',(b as HTMLElement).dataset.type===type));
      visible=show===true&&!close;this.panelVisible=visible;
    },togglePanel(show:boolean){calls.push(`panel:${show}`);visible=show;this.panelVisible=show;}};
  const win=dom.window as unknown as Window,previous=win.siyuan;
  const previousCss=globalThis.CSS;
  Object.defineProperty(globalThis,'CSS',{configurable:true,value:{escape:(s:string)=>s}});
  Object.defineProperty(win,'siyuan',{configurable:true,value:{layout:{leftDock:dock}}});
  const navigation=new DockNavigation('yzc-RSSnavigation'),open=()=>{opens++;navigation.setActive(true);};
  try{
    navigation.toggleFromActivity(false,open);assert.equal(opens,1);assert.equal(visible,true);
    navigation.toggleFromActivity(true,open);assert.equal(visible,false);assert.equal(opens,1,'collapse never opens/reselects reader');
    assert.equal(calls.at(-1),'yzc-RSSnavigation:false:true');
    navigation.setActive(true);assert.equal(visible,false,'host activity notification respects manual collapse');
    navigation.setActive(false);assert.equal(visible,false,'switch back to documents preserves collapsed host layout');
    assert(document.querySelector('[data-type="file"]')!.classList.contains('dock__item--active'));
    navigation.setActive(true);assert.equal(visible,false,'switching RSS window does not forcibly reopen sidebar');
    navigation.toggleFromActivity(true,open);assert.equal(visible,true);assert.equal(opens,2);
    navigation.setActive(false);assert.equal(visible,true,'expanded sidebar restores document dock normally');
    navigation.open(open);assert.equal(visible,true,'explicit command opens navigation');
    dock.togglePanel(false);navigation.dispose();assert.equal(visible,false,'unload does not expand a collapsed sidebar');
  }finally{
    Object.defineProperty(win,'siyuan',{configurable:true,value:previous});
    Object.defineProperty(globalThis,'CSS',{configurable:true,value:previousCss});document.body.replaceChildren();
  }
});
