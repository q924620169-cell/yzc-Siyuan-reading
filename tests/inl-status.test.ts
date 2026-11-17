import test from 'node:test';
import assert from 'node:assert/strict';
import {initialStatus,STATUS_ATTRIBUTE,isStatus} from '../plugin/src/inl/inl-status';
import {roleAttribute} from '../plugin/src/inl/inl-storage';

test('internal status is single valued and independent of content tags',()=>{
  assert.equal(initialStatus({tags:'资料库,工作,个人'},'/a.sy','box',{}),'inbox');
  assert.equal(initialStatus({tags:'未分类',[STATUS_ATTRIBUTE]:'library'},'/a.sy','box',{}),'library');
  assert.equal(isStatus('now,library'),false);
  assert.equal(initialStatus({[STATUS_ATTRIBUTE]:'invalid'},'/a.sy','box',{},'now'),'now');
});
test('legacy roles retain Now and use the closest notebook/parent scope without changing storage',()=>{
  const attrs={[roleAttribute('box/') ]:'library',[roleAttribute('box/parent')]:'now'};
  assert.equal(initialStatus(attrs,'/parent/child.sy','box',{}),'now');
  assert.equal(initialStatus({...attrs,[STATUS_ATTRIBUTE]:'inbox'},'/parent/child.sy','box',{}),'inbox');
  assert.equal(initialStatus({'custom-inl-role':'library'},'/a.sy','box',{}),'library');
});
