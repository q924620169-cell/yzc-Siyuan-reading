import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSettings,STYLES,selectStyle} from '../plugin/src/settings';
test('v0.4 settings and legacy Neutral migrate without touching windows or roles',()=>{
  const old={schemaVersion:1,style:'neutral',typography:'anthropic',inlEnabled:true,coloredTree:true,notebookCounts:true,inlFocusNavigation:true};
  const value=normalizeSettings(old);
  assert.equal(value.schemaVersion,2);assert.equal(value.style,'notion');assert.equal(value.typography,'anthropic');
  assert.equal(value.inlSingleSection,false);assert.equal(value.inlFocusNavigation,true);assert.equal(value.inlEnabled,true);
  assert.equal(old.style,'neutral');assert.deepEqual(STYLES,['notion','anthropic']);
  assert.deepEqual(selectStyle('anthropic'),{style:'anthropic',typography:'anthropic'});
  const saved=normalizeSettings({...value,inlSingleSection:true});assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(saved))),saved);
});
