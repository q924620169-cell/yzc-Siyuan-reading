import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';
import {JSDOM} from 'jsdom';
import {scopeCss,THEME_GATE,PLUGIN_GATE} from '../scripts/scope-css.mjs';

test('enabled plugin CSS hides native editor rows before plugin startup on Default Light before JS and releases them when plugin CSS is removed',()=>{
  const parsed=postcss.parse(scopeCss(readFileSync('plugin/styles/host-navigation.css','utf8')));
  const rule=parsed.nodes.find(node=>node.type==='rule' && node.selector.includes(':has(> .layout-tab-bar):not([data-yzc-native-tabs])'));
  const dom=new JSDOM('<html data-light-theme="daylight" data-theme-mode="light"><head></head><body><div class="layout__center"><div data-type="wnd"><div class="fn__flex"><ul class="layout-tab-bar"></ul></div></div></div></body></html>');
  const style=dom.window.document.createElement('style');style.id='pluginsStyleyzc-INL';style.textContent=`.fn__flex {display:flex} ${rule}`;dom.window.document.head.append(style);
  const row=dom.window.document.querySelector('.fn__flex');
  assert.equal(dom.window.getComputedStyle(row).display,'none','no plugin root attribute or mounted WindowBar is needed');
  row.setAttribute('data-yzc-native-tabs','');assert.equal(dom.window.getComputedStyle(row).display,'flex','actual tool tab opt-in');
  row.removeAttribute('data-yzc-native-tabs');style.remove();
  assert.notEqual(dom.window.getComputedStyle(row).display,'none');dom.window.close();
});
