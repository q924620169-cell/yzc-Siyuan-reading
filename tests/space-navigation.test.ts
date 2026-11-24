import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { NavigationPreferences } from '../plugin/src/navigation-order';

const bundle = buildSync({
  entryPoints: ['plugin/src/adapters/space-navigation.ts'],
  bundle: true, format: 'cjs', platform: 'node', external: ['siyuan'], write: false,
}).outputFiles[0].text;

function fixture() {
  const css = readFileSync('plugin/styles/spaces.css', 'utf8');
  const dom = new JSDOM(`<!doctype html><style>${css}</style>
    <div id="dockLeft">
      <button class="dock__item" data-type="file">文档树</button>
      <button class="dock__item" data-type="unrelated-plugin">其他插件</button>
      <button class="dock__item" data-type="yzc-Siyuan-readingreading">书房</button>
      <button class="dock__item" data-type="yzc-Siyuan-readingrss-navigation">RSS</button>
    </div>
    <div class="layout__dockl"></div><div id="status"></div>`, { pretendToBeVisual: true });
  const doc = dom.window.document;
  const rail = doc.querySelector<HTMLElement>('#dockLeft')!;
  const status = doc.querySelector('#status')!;
  const calls: string[] = [];
  const windows = {
    activeSpace: 'document', subscribe: () => () => {}, hasTool: () => true,
    selectDocuments: () => calls.push('document'), openTool: (id: string) => calls.push(id),
  };
  const mod = { exports: {} as any };
  runInNewContext(bundle, { module: mod, exports: mod.exports, require: () => ({ toggleLeftDock() {} }) });
  const attachToggle = (collapsed = false, hidden = false) => {
    const toggle = doc.createElement('button');
    toggle.id = 'barDock';
    toggle.classList.toggle('fn__none', hidden);
    toggle.innerHTML = '<svg><use></use></svg>';
    const icon = toggle.querySelector('use')!;
    const sync = () => {
      rail.hidden = collapsed;
      icon.setAttribute('xlink:href', collapsed ? '#iconDock' : '#iconHideDock');
    };
    sync();
    toggle.onclick = () => { collapsed = !collapsed; sync(); };
    status.append(toggle);
    return toggle;
  };
  const mount = (preferences?:NavigationPreferences) => new mod.exports.SpaceNavigation(windows, doc, preferences);
  return { dom, doc, rail, status, calls, attachToggle, mount, windows };
}

test('only an already active space can be renamed by double click; right click stays silent',async()=>{
  const {dom,doc,mount,windows,calls}=fixture();
  const saved:unknown[]=[];
  const fail=(error:unknown)=>assert.fail(String(error));
  const preferences=new NavigationPreferences(null,async state=>{saved.push(state);},fail);
  const navigation=mount(preferences);
  try{
    const reader=doc.querySelector<HTMLButtonElement>('[data-space="yzc-Reader"]')!;
    const click=(type:string,detail:number)=>reader.dispatchEvent(new dom.window.MouseEvent(type,{bubbles:true,cancelable:true,detail}));
    assert.equal(click('contextmenu',0),false);
    assert.equal(click('click',1),true);
    windows.activeSpace='yzc-Reader';
    click('click',2);click('dblclick',2);
    assert.equal(doc.querySelector('.yzc-space-rename'),null);
    click('click',1);click('click',2);click('dblclick',2);
    const field=doc.querySelector<HTMLInputElement>('.yzc-space-rename input')!;
    assert.equal(field.value,'书房');
    field.value='  自选名称  ';
    field.form!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
    assert.equal(reader.getAttribute('aria-label'),'自选名称');
    await Promise.resolve();await Promise.resolve();
    const restored=new NavigationPreferences(saved.at(-1),async()=>{},fail);
    assert.equal(restored.name('yzc-Reader','书房'),'自选名称');
    assert.deepEqual(calls,['yzc-Reader']);
  }finally{navigation.dispose();dom.window.close();}
});

test('dock rail collapses once and the native toggle restores other entries without duplicates', async () => {
  const { dom, doc, rail, status, calls, attachToggle, mount } = fixture();
  const toggle = attachToggle();
  const nav = mount();
  try {
    assert.equal(rail.hidden, true);
    assert.equal(toggle.querySelector('use')!.getAttribute('xlink:href'), '#iconDock');
    toggle.click();
    status.append(doc.createElement('span'));
    await Promise.resolve();
    assert.equal(rail.hidden, false, 'a layout mutation must not undo manual expansion');
    const display = (selector: string) => dom.window.getComputedStyle(doc.querySelector<HTMLElement>(selector)!).display;
    assert.notEqual(display('#dockLeft'), 'none');
    assert.notEqual(display('[data-type="file"]'), 'none');
    assert.notEqual(display('[data-type="unrelated-plugin"]'), 'none');
    assert.equal(display('[data-type="yzc-Siyuan-readingreading"]'), 'none');
    assert.equal(display('[data-type="yzc-Siyuan-readingrss-navigation"]'), 'none');
    doc.querySelector<HTMLElement>('[data-space="yzc-Reader"]')!.click();
    doc.querySelector<HTMLElement>('[data-space="yzc-RSS"]')!.click();
    assert.deepEqual(calls, ['yzc-Reader', 'yzc-RSS']);
  } finally {
    nav.dispose();
    dom.window.close();
  }
});

test('an already collapsed rail stays collapsed and an unavailable toggle is left alone', async () => {
  const { dom, rail, attachToggle, mount } = fixture();
  const unavailable = attachToggle(false, true);
  const nav = mount();
  try {
    assert.equal(rail.hidden, false);
    unavailable.remove();
    const toggle = attachToggle(true);
    await Promise.resolve();
    assert.equal(rail.hidden, true);
    toggle.click();
    await Promise.resolve();
    assert.equal(rail.hidden, false);
  } finally {
    nav.dispose();
    dom.window.close();
  }
});
