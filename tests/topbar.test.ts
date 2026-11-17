import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildSync } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { normalizeSettings } from '../plugin/src/settings';

// Exercise the actual adapter against the host's named-menu toggle and shared overlay contract.
test('topbar survives replacement; style syncs typography and manual font override survives until next style choice', async () => {
  const dom = new JSDOM('<div id="toolbar"></div><button id="outside">Outside</button>');
  const doc = dom.window.document;
  Object.defineProperty(dom.window.HTMLElement.prototype, 'getClientRects', {value() {return this.isConnected && !this.hidden ? [{}] : [];}});
  let current: Menu | undefined;
  let retainedName = 'yzc-menu';
  class Menu {
    element: HTMLElement; isOpen: boolean;
    constructor(name?: string, private callback?: () => void) {
      this.isOpen = !!name && name === retainedName;
      current?.close();
      if(name) retainedName = name;
      this.element = doc.createElement('div'); this.element.id='commonMenu'; this.element.hidden=true; doc.body.append(this.element); current=this;
    }
    addItem(item: any) {
      assert.equal(this.isOpen,false,'host named toggle must not suppress menu rendering');
      const el=doc.createElement(item.type === 'empty' ? 'div' : 'button');
      if(item.bind) item.bind(el); else {el.textContent=item.label; el.onclick=() => {void item.click?.();};}
      this.element.append(el); return el;
    }
    open() {this.element.hidden=false;}
    close() {this.element?.remove(); this.callback?.();}
  }
  const output=buildSync({entryPoints:['plugin/src/adapters/topbar-adapter.ts'],bundle:true,format:'cjs',platform:'node',external:['siyuan'],write:false});
  const mod={exports:{} as any};
  runInNewContext(output.outputFiles[0].text,{module:mod,exports:mod.exports,require:(name:string) => {assert.equal(name,'siyuan'); return {Menu};},document:doc,AbortController:dom.window.AbortController});
  let settings=normalizeSettings({style:'notion',typography:'anthropic'});
  const plugin={addTopBar({element}:any) {element.id='yzc-test';doc.querySelector('#toolbar')!.append(element); return element;},removeTopBar() {}};
  const adapter=new mod.exports.TopbarAdapter(plugin,()=>settings,async (patch:any)=>{settings=normalizeSettings({...settings,...patch}); adapter.render();});
  let button=doc.querySelector<HTMLElement>('.yzc-topbar')!;
  button.click(); assert.equal(doc.querySelectorAll('.yzc-appearance').length,1); assert.equal(button.getAttribute('aria-expanded'),'true');
  button.click(); assert.equal(doc.querySelectorAll('.yzc-appearance').length,0);
  // Layout replacement drops element-bound handlers; delegated capture must continue to work.
  const clone=button.cloneNode(true) as HTMLElement; button.replaceWith(clone); button=clone;
  button.click(); assert.equal(doc.querySelectorAll('.yzc-appearance').length,1);
  (doc.querySelector('#outside') as HTMLElement).click(); assert.equal(doc.querySelectorAll('.yzc-appearance').length,0);
  button.click();
  (doc.querySelector('[aria-label="视觉风格 Anthropic"]') as HTMLElement).click(); await Promise.resolve();
  assert.equal(settings.style,'anthropic'); assert.equal(settings.typography,'anthropic');
  button.click(); (doc.querySelector('[aria-label="字体 Notion"]') as HTMLElement).click(); await Promise.resolve();
  assert.equal(settings.style,'anthropic'); assert.equal(settings.typography,'notion');
  // Re-selecting the same visual style also restores its matching typography.
  button.click(); (doc.querySelector('[aria-label="视觉风格 Anthropic"]') as HTMLElement).click(); await Promise.resolve();
  assert.equal(settings.style,'anthropic'); assert.equal(settings.typography,'anthropic');
  button.click(); (doc.querySelector('[aria-label="视觉风格 Notion"]') as HTMLElement).click(); await Promise.resolve();
  assert.equal(settings.style,'notion'); assert.equal(settings.typography,'notion');
  button.click(); (doc.querySelector('[aria-label="字体 Anthropic"]') as HTMLElement).click(); await Promise.resolve();
  assert.equal(settings.style,'notion'); assert.equal(settings.typography,'anthropic');
  button.click(); assert.equal(doc.querySelector('[aria-label="视觉风格 Neutral"]'),null);
  assert.deepEqual(Array.from(doc.querySelectorAll('.yzc-menu-heading')).map(el=>el.textContent),['外观']);
  assert.equal(Array.from(doc.querySelectorAll('button')).some(el=>el.textContent==='INL'),false);
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape'}));
  button.click(); assert.equal(Array.from(doc.querySelectorAll('button')).some(el=>el.textContent==='笔记本计数'),false);
  assert.equal(settings.notebookCounts,true);
  assert.equal(normalizeSettings(JSON.parse(JSON.stringify(settings))).notebookCounts,true);
  assert.equal(settings.inlFocusNavigation,false);
  button.click();
  assert.equal(Array.from(doc.querySelectorAll('button')).some(el=>el.textContent==='聚焦文档树'||el.textContent==='单区展开'),false);
  assert.equal(Array.from(doc.querySelectorAll('button')).some(el=>el.textContent==='RSS 导入目标'),false);
  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  button.click(); doc.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(doc.querySelectorAll('.yzc-appearance').length,0);
  // Native cleanup may remove our overlay without disposing its Menu object.
  button.click();doc.querySelector('.yzc-appearance')!.remove();
  const nativeMenu=doc.createElement('div');nativeMenu.id='native-menu';doc.body.append(nativeMenu);
  (doc.querySelector('#outside') as HTMLElement).click();
  assert.equal(nativeMenu.isConnected,true,'outside click must not close an unrelated native menu');
  nativeMenu.remove();
  adapter.dispose(); assert.equal(doc.querySelectorAll('.yzc-topbar').length,0);
  dom.window.close();
});
