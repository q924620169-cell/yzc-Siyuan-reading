import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {SsdToastAdapter} from '../plugin/src/adapters/ssd-toast-adapter';
const message='工作空间未放置在固态硬盘上，这会导致显著的性能下降，建议将工作空间放置在固态硬盘上使用';
test('only the exact SSD workspace toast is removed, including version suffix; unload releases observer',async()=>{
  const dom=new JSDOM('<div id="messages"></div>'),doc=dom.window.document;
  const append=(id:string,text:string)=>{const toast=doc.createElement('div');toast.className='b3-snackbar';toast.id=id;const content=doc.createElement('div');content.className='b3-snackbar__content';content.textContent=text;toast.append(content);doc.querySelector('#messages')!.append(toast);};
  append('old',message+' v3.8.7');const adapter=new SsdToastAdapter(doc);assert.equal(doc.querySelector('#old'),null);
  append('ssd',message+' v3.8.7');append('warning','普通 warning');append('error','数据同步错误');append('similar','测试内容：'+message);
  await Promise.resolve();assert.equal(doc.querySelector('#ssd'),null);
  for(const id of ['warning','error','similar'])assert(doc.querySelector('#'+id));
  adapter.dispose();append('after',message);await Promise.resolve();assert(doc.querySelector('#after'));dom.window.close();
});
