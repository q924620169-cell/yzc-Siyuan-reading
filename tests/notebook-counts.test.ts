import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookCounts, type CountNode } from '../plugin/src/enhancements/notebook-counts';
import { HostEventsAdapter } from '../plugin/src/adapters/host-events-adapter';

test('counts use notebook API totals and native direct children, cache rerenders and refresh structural changes', async () => {
  let nodes: CountNode[] = [{id:'notebook:book',notebook:'book'},{id:'folder',count:2},{id:'child',count:9},{id:'leaf',count:0}];
  let shown = new Map<string,number>(), calls=0, rootCount=3;
  const counts=new NotebookCounts({countNodes:()=>nodes,showCounts:value=>{shown=new Map(value);}},async()=>{calls++;return rootCount;});
  counts.configure(true); await counts.refresh();
  assert.equal(calls,1);
  assert.deepEqual([...shown], [['notebook:book',3],['folder',2],['child',9]]);
  // A rerender may replace every row; counts are reapplied without refetching.
  nodes=nodes.map(node=>({...node})); await counts.refresh(); assert.equal(calls,1);
  rootCount=4; nodes[1].count=3; await counts.refresh(true);
  assert.equal(calls,2); assert.equal(shown.get('notebook:book'),4); assert.equal(shown.get('folder'),3);
  counts.configure(false); assert.equal(shown.size,0);
  counts.dispose();
});

test('turning counts off or replacing an in-flight notebook read cannot show stale values', async () => {
  let shown=new Map<string,number>();
  const releases: ((count:number)=>void)[]=[];
  const counts=new NotebookCounts({countNodes:()=>[{id:'book',notebook:'book'}],showCounts:value=>{shown=new Map(value);}},()=>new Promise(resolve=>releases.push(resolve)));
  counts.configure(true);
  const latest=counts.refresh(true); releases[1](4); await latest;
  releases[0](9); await Promise.resolve();await Promise.resolve();
  assert.equal(shown.get('book'),4);
  const pending=counts.refresh(true); counts.configure(false); releases[2](20); await pending;
  assert.equal(shown.size,0);
  counts.dispose();
});

test('zero notebooks are shown; failed notebook reads do not masquerade as zero and can retry', async () => {
  let failed=true,shown=new Map<string,number>();
  const counts=new NotebookCounts({countNodes:()=>[{id:'book',notebook:'book'}],showCounts:value=>{shown=new Map(value);}},async()=>{if(failed)throw Error('offline');return 0;});
  counts.configure(true); await counts.refresh();assert.equal(shown.has('book'),false);
  failed=false;await counts.refresh();assert.equal(shown.get('book'),0);
  counts.dispose();assert.equal(shown.size,0);
});

test('host create/remove/move/notebook events invalidate counts, reading navigation does not', () => {
  const handlers=new Map<string,Function>();let invalidated=0;
  const bus={on:(name:string,fn:Function)=>handlers.set(name,fn),off:(name:string)=>handlers.delete(name)};
  const adapter=new HostEventsAdapter({eventBus:bus} as any,()=>{},()=>{},()=>invalidated++);
  for(const cmd of ['create','removeDoc','moveDocs','mount','closeBox']) handlers.get('ws-main')!({detail:{cmd}});
  assert.equal(invalidated,5);
  handlers.get('switch-protyle')!(); handlers.get('ws-main')!({detail:{cmd:'transactions'}});
  assert.equal(invalidated,5);
  adapter.dispose();assert.equal(handlers.size,0);
});
