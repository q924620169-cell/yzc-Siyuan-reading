import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fontMetadata} from '../scripts/font-metadata.mjs';
test('heading CJK uses original ZhenKai regular metadata, with Screen body and frozen Notion metrics',()=>{
  const metadata=fontMetadata(readFileSync('visual/fonts/lxgw-zhenkai/LXGWZhenKaiGB-Regular.ttf'));
  assert.equal(metadata.weight,400);assert(metadata.names[1].includes('LXGW ZhenKai GB'));
  const css=readFileSync('visual/typography/presets.css','utf8');
  assert(css.includes("--sv-heading-font: var(--sv-content-latin), 'LXGW ZhenKai GB', serif"));
  assert(css.includes("--sv-content-cjk: 'YZC WenKai Screen', 'LXGW WenKai Screen'"));
  assert(css.includes('--svs-body-size: 17px'));assert(css.includes('--svs-line-height: 1.68'));
  assert(css.includes('--svs-body-size: 16px'));assert(css.includes('--svs-line-height: 1.55'));
  assert(css.includes('font-synthesis:none'));assert(css.includes('--sv-heading-weight: 400'));
  assert(css.includes('font-family:var(--sv-heading-font);font-weight:400'));
  assert(readFileSync('visual/fonts/lxgw-zhenkai/OFL.txt','utf8').includes('SIL OPEN FONT LICENSE Version 1.1'));
});
