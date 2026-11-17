import test from 'node:test';
import assert from 'node:assert/strict';
import {rssCounterActive} from '../src/host';

test('RSS counter hides while the RSS tool is active and focused',()=>{
 assert.equal(rssCounterActive(true,true,true),true);
 assert.equal(rssCounterActive(true,true,undefined),true,'bridge fallback while focus is unavailable');
 assert.equal(rssCounterActive(true,false,true),false,'document switch overrides a stale RSS tab');
 assert.equal(rssCounterActive(false,false,true),true,'native fallback without bridge');
});

test('a focused document or PDF overrides stale bridge activity',()=>{
 assert.equal(rssCounterActive(true,true,false),false);
 assert.equal(rssCounterActive(false,true,false),false);
});
