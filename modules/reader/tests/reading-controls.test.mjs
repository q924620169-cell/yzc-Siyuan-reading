import test from'node:test';
import assert from'node:assert/strict';
import{readingZoom,zoomValue,textScale,ReadingControls}from'../src/reading-controls.js';

test('native numeric scales and layout modes retain their meaning across engines',()=>{
 const percent=readingZoom('0.75');
 assert.deepEqual(percent,{mode:'percent',scale:.75});
 assert.equal(textScale(percent),.75);assert.equal(zoomValue(percent),.75);
 for(const mode of ['auto','page-fit','page-width','page-actual']){
  const zoom=readingZoom({mode});assert.equal(zoomValue(zoom),mode);
  assert.equal(textScale(zoom),1);assert.deepEqual(zoom,{mode});
 }
 for(const value of [undefined,null,NaN,-2,0,11,{mode:'percent',scale:0}])
  assert.deepEqual(readingZoom(value),{mode:'page-actual'});
});

test('course zoom is owned by the envelope and maximize stays in memory',()=>{
 const envelope={course:{articles:{one:{completed:true},two:{}}}},root={classList:{remove(){}}};
 const ui={root,syncTheme(){},library:{saveState(){}}};
 const controls=new ReadingControls({ui});
 controls.begin({id:'course'},envelope);
 controls.changeZoom(.75);controls.clearSave();
 assert.deepEqual(envelope.zoom,{mode:'percent',scale:.75});
 assert.deepEqual(envelope.course.articles,{one:{completed:true},two:{}});
 controls.maximized=true;controls.prepare({id:'course'});
 assert.equal(controls.maximized,true);
 controls.begin({id:'course'},structuredClone(envelope));
 assert.equal(controls.scale,.75);
 controls.prepare({id:'another'});assert.equal(controls.maximized,false);
 assert.equal('maximized'in envelope,false);
});
