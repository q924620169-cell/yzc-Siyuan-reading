import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { JSDOM } from 'jsdom';

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
  const mount = () => new mod.exports.SpaceNavigation(windows, doc);
  return { dom, doc, rail, status, calls, attachToggle, mount };
}

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
