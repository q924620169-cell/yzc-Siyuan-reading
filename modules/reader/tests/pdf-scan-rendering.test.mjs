import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareScanRendering} from '../src/pdf-scan-rendering.js';

test('native page methods are restored when the reading session detaches',()=>{
 const {pdf,page,render}=fixture();
 const stop=new AbortController(),dispose=prepareScanRendering(pdf,stop.signal);
 assert.notEqual(page.render,render);dispose();assert.equal(page.render,render);
 prepareScanRendering(pdf,stop.signal);assert.notEqual(page.render,render);
 stop.abort();assert.equal(page.render,render);
});

function fixture(numPages=1) {
  const draws=[];
  const canvas={height:2100,getContext:()=>context};
  const context={
    canvas,imageSmoothingEnabled:false,imageSmoothingQuality:'low',
    getTransform:()=>({a:1,b:0,c:0,d:1,f:-600}),
    drawImage(_image,...args){draws.push({args,quality:this.imageSmoothingQuality,smoothing:this.imageSmoothingEnabled});},
  };
  const image={width:551,height:13502};
  const drawArgs=[0,0,551,13502,0,0,918,22503];
  const render=options=>{
    options.canvas.getContext('2d').drawImage(image,...drawArgs);
    return {promise:Promise.resolve()};
  };
  const page={view:[0,0,551,13502],render};
  const pdf={pdfDocument:{numPages},pdfViewer:{getPageView:()=>({pdfPage:page})},eventBus:{on(){}}};
  return {canvas,context,draws,drawArgs,page,pdf,render};
}

test('long scan samples only the visible strip and restores the native canvas methods',async()=>{
  const {canvas,context,draws,page,pdf}=fixture();
  const getContext=canvas.getContext,drawImage=context.drawImage;
  const stop=new AbortController();
  prepareScanRendering(pdf,stop.signal);
  await page.render({canvas}).promise;
  assert.equal(draws[0].quality,'high');
  assert.equal(draws[0].smoothing,true);
  const [,sourceY,,rows,,targetY,,targetHeight]=draws[0].args;
  assert(sourceY>0&&rows<1700);
  assert(targetY<600&&targetY+targetHeight>2700);
  assert.equal(canvas.getContext,getContext);
  assert.equal(context.drawImage,drawImage);
  assert.equal(context.imageSmoothingQuality,'low');
  assert.equal(context.imageSmoothingEnabled,false);
  stop.abort();
  await page.render({canvas}).promise;
  assert.equal(draws[1].quality,'low');
});

test('ordinary documents and oversized interpolation operations keep native rendering',async()=>{
  const ordinary=fixture(2);
  prepareScanRendering(ordinary.pdf,new AbortController().signal);
  assert.equal(ordinary.page.render,ordinary.render);

  const large=fixture();
  large.canvas.height=10000;
  prepareScanRendering(large.pdf,new AbortController().signal);
  await large.page.render({canvas:large.canvas}).promise;
  assert.deepEqual(large.draws[0],{args:large.drawArgs,quality:'low',smoothing:false});
});
