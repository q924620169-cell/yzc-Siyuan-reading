import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { DocumentTreeAdapter } from '../plugin/src/adapters/document-tree-adapter';
import { projectTree } from '../plugin/src/inl/inl-tree';
import { InlController } from '../plugin/src/inl/inl-controller';
import { InlStorage, roleAttribute } from '../plugin/src/inl/inl-storage';
import { decodeCreation } from '../plugin/src/adapters/host-events-adapter';

const markup = `<div class="file-tree"><div class="block__icons"><span data-type="min"></span></div><div class="file-tree__items"><ul data-url="book"><li data-type="navigation-root" data-count="2"></li><ul><li data-type="navigation-file" data-node-id="a" data-name="项目" data-count="1"><span class="b3-list-item__text">项目</span></li><ul><li data-type="navigation-file" data-node-id="c" data-name="日期复盘" data-count="0"><span class="b3-list-item__text">日期复盘</span></li></ul><li data-type="navigation-file" data-node-id="b" data-name="阅读" data-count="0"><span class="b3-list-item__text">阅读</span></li></ul></ul></div></div>`;
test('single-section scopes commit Root and Local accordion states atomically, allow all closed and isolate siblings',()=>{
  let paint=()=>{};const {dom,adapter,doc}=setup({refresh:()=>paint(),repaint:()=>paint()});
  paint=()=>{const groups=adapter.groups();adapter.present(groups.map(group=>({group,projection:projectTree(group.nodes,{kind:'root'},true)})),false);};
  paint();adapter.configureSingleSection(true);
  const toggle=(key:string,role:string)=>doc.querySelector<HTMLButtonElement>(`.yzc-section[data-yzc-group="${key}"][data-yzc-role="${role}"] button`)!;
  const state=(key:string)=>['now','library','inbox'].map(role=>toggle(key,role).getAttribute('aria-expanded'));
  assert.deepEqual(state('root'),['true','false','false']);
  toggle('root','library').click();assert.deepEqual(state('root'),['false','true','false']);
  toggle('root','inbox').click();assert.deepEqual(state('root'),['false','false','true']);
  toggle('root','inbox').click();assert.deepEqual(state('root'),['false','false','false']);
  toggle('root','now').click();toggle('book/','library').click();
  assert.deepEqual(state('book/'),['false','true','false']);assert.deepEqual(state('book/a'),['true','false','false']);
  adapter.configureFocus(true);
  doc.querySelector('[data-type="navigation-root"]')!.innerHTML='<span class="b3-list-item__text">Book</span>';
  (doc.querySelector('[data-type="navigation-root"] .b3-list-item__text') as HTMLElement).click();
  toggle('book/','now').click();assert.deepEqual(state('book/'),['true','false','false']);
  toggle('book/','library').click();assert.deepEqual(state('book/'),['false','true','false']);
  (doc.querySelector('.yzc-focus-back') as HTMLElement).click();
  (doc.querySelector('[data-type="navigation-root"] .b3-list-item__text') as HTMLElement).click();
  assert.deepEqual(state('book/'),['true','false','false']);
  adapter.dispose();dom.window.close();
});
function setup(actions: Partial<ConstructorParameters<typeof DocumentTreeAdapter>[0]> = {}, html = markup) {
  const dom = new JSDOM(html);
  for (const key of ['document', 'Element', 'HTMLElement', 'MutationObserver', 'AbortController'] as const) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
  const adapter = new DocumentTreeAdapter({ refresh() {}, toggleScope() {}, changeRole() {}, create() {}, ...actions }, dom.window.document);
  return { dom, adapter, doc: dom.window.document };
}

test('SiYuan 3.8.10 flat tree restores saved Root and Local roles using host occurrence keys', async () => {
  const row = (key: string, type: string, id = '', open = '') => `<li data-type="navigation-${type}" data-tree-key="notebook:${key}" data-node-id="${id}" ${open ? 'aria-expanded="true"' : ''}><span class="b3-list-item__toggle"><svg class="b3-list-item__arrow ${open}"></svg></span><span class="b3-list-item__text">${key}</span></li>`;
  const html = `<div class="file-tree"><div class="block__icons"></div><div class="file-tree__items"><ul role="tree">
    ${row('library', 'root')}
    ${row('now', 'root', '', 'b3-list-item__arrow--open')}
    ${row('now/reading', 'file', 'reading', 'b3-list-item__arrow--open')}
    ${row('now/reading/nested', 'file', 'nested')}
    <li data-tree-spacer="true" style="height:28px"></li>
    ${row('now/task', 'file', 'task')}
    ${row('inbox', 'root')}
    <li data-tree-animation="true" aria-hidden="true"></li>
  </ul></div></div>`;
  let controller: InlController | undefined;
  const {dom,adapter,doc} = setup({refresh:()=>{void controller?.refresh();}, repaint:()=>controller?.repaint()}, html);
  const storage = new InlStorage({
    async getAttributes(id) { return id === 'task' ? {[roleAttribute('now/')]: 'now'} : {}; },
    async setAttributes() { assert.fail('Restoring the view must not write document attributes'); }
  }, {
    async read(id) {
      if (id === 'notebook:now') return {enabled:true, roles:{root:'now'}};
      if (id === 'notebook:inbox') return {roles:{root:'inbox'}};
      assert.equal(id, 'notebook:library');
      return {};
    },
    async write() { assert.fail('Restoring the view must not write notebook assignments'); }
  });
  const errors: unknown[] = [];
  const selector = (scope: string, role: string) => `.yzc-section[data-yzc-group="${scope}"][data-yzc-role="${role}"] button`;
  const buttons = (scope: string) => ['now','library','inbox'].map(role=>doc.querySelector<HTMLButtonElement>(selector(scope,role))!);
  const counts = (scope: string) => buttons(scope).map(button=>Number(button.textContent?.split(/\s+/).at(-1)));
  const nativeList = doc.querySelector('ul[role="tree"]')!;
  const outgoing = doc.createElement('template');
  outgoing.innerHTML = row('now/closing', 'file', 'closing');
  nativeList.lastElementChild!.append(outgoing.content);
  const originalRows = [...nativeList.children];
  const task = doc.querySelector<HTMLElement>('[data-node-id="task"]')!;
  try {
    assert.deepEqual(adapter.groups().map(group=>[group.key,group.nodes.map(node=>node.id)]), [
      ['root',['notebook:library','notebook:now','notebook:inbox']], ['now/',['reading','task']],
      ['now/reading',['nested']], ['now/nested',[]], ['now/task',[]]
    ]);
    controller = new InlController(adapter, storage, error=>errors.push(error));
    controller.configure(true, false);
    await controller.refresh();
    assert.deepEqual(counts('root'), [1,1,1]);
    assert.deepEqual(counts('now/'), [1,1,0]);
    assert.equal(task.classList.contains('yzc-role-hidden'), false);
    assert.equal(doc.querySelector('[data-node-id="nested"]')!.classList.contains('yzc-role-hidden'), true);
    buttons('now/')[1].click();
    await controller.refresh();
    assert.equal(doc.querySelector('[data-node-id="nested"]')!.classList.contains('yzc-role-hidden'), false);
    buttons('root')[0].click();
    await controller.refresh();
    assert.equal(task.classList.contains('yzc-role-hidden'), true);
    assert.equal(buttons('now/')[0].parentElement!.classList.contains('yzc-role-hidden'), true);
    controller.configure(false, false);
    await controller.refresh();
    assert.equal(doc.querySelectorAll('.yzc-section,.yzc-flat-scroll,.yzc-role-hidden').length, 0);
    assert.deepEqual([...nativeList.children], originalRows);
    controller.configure(true, false);
    await controller.refresh();
    assert.deepEqual(counts('root'), [1,1,1]);
    assert.deepEqual(counts('now/'), [1,1,0]);
    assert.deepEqual(errors, []);
  } finally {
    controller?.dispose();
    adapter.dispose();
    dom.window.close();
  }
});

test('single-section also closes sibling notebooks through native toggles, keeps document branches and resets Local on reentry',async()=>{
  let paint=()=>{};const {dom,adapter,doc}=setup({refresh:()=>paint(),repaint:()=>paint()});
  const first=doc.querySelector<HTMLElement>('[data-type="navigation-root"]')!;
  first.innerHTML='<span class="b3-list-item__toggle"><i class="b3-list-item__arrow"></i></span><span class="b3-list-item__text">Book</span>';
  doc.querySelector('.file-tree__items')!.insertAdjacentHTML('beforeend','<ul data-url="other"><li data-type="navigation-root"><span class="b3-list-item__toggle"><i class="b3-list-item__arrow"></i></span><span class="b3-list-item__text">Other</span></li><ul><li data-type="navigation-file" data-node-id="other-doc"><span class="b3-list-item__text">Other doc</span></li></ul></ul>');
  const roots=[...doc.querySelectorAll<HTMLElement>('[data-type="navigation-root"]')];
  const host=(event:Event)=>{const toggle=(event.target as Element).closest('.b3-list-item__toggle');toggle?.querySelector('.b3-list-item__arrow')!.classList.toggle('b3-list-item__arrow--open');};
  doc.querySelector('.file-tree')!.addEventListener('click',host);
  paint=()=>{const groups=adapter.groups();adapter.present(groups.map(group=>({group,projection:projectTree(group.nodes,{kind:'root'},true)})),false);};paint();
  const open=(row:HTMLElement)=>!!row.querySelector('.b3-list-item__arrow--open');
  const click=async(row:HTMLElement)=>{row.querySelector<HTMLElement>('.b3-list-item__text')!.click();await Promise.resolve();await Promise.resolve();};
  await click(roots[0]);await click(roots[1]);assert(roots.every(open),'OFF retains independent notebook expansion');
  adapter.configureSingleSection(true);await Promise.resolve();assert.deepEqual(roots.map(open),[true,false]);
  const section=(key:string,role:string)=>doc.querySelector<HTMLButtonElement>(`.yzc-section[data-yzc-group="${key}"][data-yzc-role="${role}"] button`)!;
  section('book/','library').click();
  const child=doc.querySelector('[data-node-id="a"]')!;child.insertAdjacentHTML('afterbegin','<i class="b3-list-item__arrow b3-list-item__arrow--open"></i>');
  await click(roots[1]);assert.deepEqual(roots.map(open),[false,true]);assert.equal(adapter.current(),'notebook:other');
  assert(child.querySelector('.b3-list-item__arrow--open'),'opening sibling notebooks does not alter nested document expansion');
  await click(roots[0]);assert.deepEqual(roots.map(open),[true,false]);
  assert.equal(section('book/','now').getAttribute('aria-expanded'),'true');assert.equal(section('book/','library').getAttribute('aria-expanded'),'false');
  await click(roots[0]);assert(roots.every(row=>!open(row)),'all notebooks may close');
  adapter.configureSingleSection(false);await click(roots[0]);await click(roots[1]);assert(roots.every(open));
  adapter.dispose();dom.window.close();
});

test('closing one Local INL scope resets only itself before reopening, including all-collapsed state',async()=>{
  let repaint=()=>{};
  const {dom,adapter,doc}=setup({refresh:()=>repaint(),repaint:()=>repaint()});
  for(const row of doc.querySelectorAll('[data-type="navigation-root"],[data-node-id="a"]'))row.insertAdjacentHTML('afterbegin','<span class="b3-list-item__arrow b3-list-item__arrow--open"></span>');
  repaint=()=>{const groups=adapter.groups();adapter.present(groups.map(group=>({group,projection:projectTree(group.nodes,{kind:'root'},true)})),false);};
  repaint();
  const toggle=(key:string,role:string)=>doc.querySelector<HTMLButtonElement>(`.yzc-section[data-yzc-group="${key}"][data-yzc-role="${role}"] button`)!;
  toggle('book/a','library').click();
  toggle('book/','library').click();
  const arrow=doc.querySelector('[data-type="navigation-root"] .b3-list-item__arrow')!;
  for(const allClosed of [false,true]) {
    if(allClosed)toggle('book/','now').click();
    arrow.classList.remove('b3-list-item__arrow--open');await Promise.resolve();
    // The outgoing tree is unchanged during collapse; reset is consumed by open.
    const before=toggle('book/','now').getAttribute('aria-expanded');
    repaint();assert.equal(toggle('book/','now').getAttribute('aria-expanded'),before);
    arrow.classList.add('b3-list-item__arrow--open');await Promise.resolve();repaint();
    assert.equal(toggle('book/','now').getAttribute('aria-expanded'),'true');
    assert.equal(toggle('book/','library').getAttribute('aria-expanded'),'false');
    assert.equal(toggle('book/','inbox').getAttribute('aria-expanded'),'false');
    assert.equal(toggle('book/a','library').getAttribute('aria-expanded'),'true','other scope retains its own state');
  }
  // A document container follows exactly the same close/open rule.
  const childArrow=doc.querySelector('[data-node-id="a"] .b3-list-item__arrow')!;
  childArrow.classList.remove('b3-list-item__arrow--open');await Promise.resolve();
  childArrow.classList.add('b3-list-item__arrow--open');await Promise.resolve();
  assert.equal(toggle('book/a','library').getAttribute('aria-expanded'),'false');
  adapter.dispose();dom.window.close();
});

test('focus return closes only the scope being left; reentry starts with NOW only',async()=>{
  let repaint=()=>{};
  const {dom,adapter,doc}=setup({refresh:()=>repaint(),repaint:()=>repaint()});
  doc.querySelector('[data-type="navigation-root"]')!.innerHTML='<span class="b3-list-item__text">Book</span>';
  repaint=()=>{const groups=adapter.groups();adapter.present(groups.map(group=>({group,projection:projectTree(group.nodes,{kind:'root'},true)})),false);};
  repaint();adapter.configureFocus(true);
  (doc.querySelector('[data-type="navigation-root"] .b3-list-item__text') as HTMLElement).click();
  (doc.querySelector('.yzc-section[data-yzc-role="library"] button') as HTMLElement).click();
  (doc.querySelector('[data-node-id="a"] .b3-list-item__text') as HTMLElement).click();await Promise.resolve();
  (doc.querySelector('.yzc-section[data-yzc-role="now"] button') as HTMLElement).click();
  (doc.querySelector('.yzc-section[data-yzc-role="library"] button') as HTMLElement).click();
  (doc.querySelector('.yzc-focus-back') as HTMLElement).click();
  assert.equal(doc.querySelector('.yzc-section[data-yzc-role="library"] button')!.getAttribute('aria-expanded'),'true','parent remains open, not reset by child return');
  (doc.querySelector('[data-node-id="a"] .b3-list-item__text') as HTMLElement).click();await Promise.resolve();
  assert.equal(doc.querySelector('.yzc-section[data-yzc-role="now"] button')!.getAttribute('aria-expanded'),'true');
  assert.equal(doc.querySelector('.yzc-section[data-yzc-role="library"] button')!.getAttribute('aria-expanded'),'false');
  adapter.dispose();dom.window.close();
});
test('child count labels survive native row replacement without changing INL rows or scope placement', () => {
  const {dom,adapter,doc}=setup();
  const root=doc.querySelector('[data-type="navigation-root"]')!;
  root.innerHTML='<span class="b3-list-item__text">Book</span>';
  assert.deepEqual(adapter.countNodes(),[{id:'notebook:book',notebook:'book'},{id:'a',count:1},{id:'c',count:0},{id:'b',count:0}]);
  const counts=new Map([['notebook:book',2],['a',1]]);
  adapter.showCounts(counts);adapter.showCounts(counts);
  assert.equal(doc.querySelectorAll('.yzc-child-count').length,2);
  assert.equal(root.querySelector('.yzc-child-count')!.textContent,'2');
  const groups=adapter.groups();adapter.present(groups.map(group=>({group,projection:projectTree(group.nodes,{kind:'root'},true)})),false);
  const row=doc.querySelector('[data-node-id="a"]')!;
  row.outerHTML='<li data-type="navigation-file" data-node-id="a" data-count="1"><span class="b3-list-item__text">Replaced</span></li>';
  adapter.showCounts(counts);
  assert.equal(doc.querySelectorAll('.yzc-child-count').length,2);
  const sections=doc.querySelectorAll('.yzc-section').length;
  adapter.showCounts(new Map());assert.equal(doc.querySelectorAll('.yzc-child-count').length,0);
  assert.equal(doc.querySelectorAll('.yzc-section').length,sections);
  adapter.dispose();dom.window.close();
});
test('native nodes are unique, parent/order untouched, restore is exact', () => {
  const { dom, adapter, doc } = setup();
  const before = doc.querySelector('.file-tree__items')!.innerHTML;
  const a = doc.querySelector('[data-node-id="a"]')!;
  const groups = adapter.groups();
  adapter.present(groups.map(group => ({ group, projection: projectTree(group.nodes, { kind: 'root' }, group.key === 'root') })), true);
  assert.equal(doc.querySelectorAll('.yzc-section').length, 3);
  assert.equal(doc.querySelectorAll('[data-node-id="a"]').length, 1);
  assert.equal(doc.querySelector('[data-node-id="a"]'), a);
  assert.equal(a.nextElementSibling?.tagName, 'UL');
  assert.equal(doc.querySelector('[data-node-id="c"]')!.classList.contains('yzc-role-hidden'), false);
  adapter.restore();
  // Browser normalization adds an empty style attr after removeProperty.
  doc.querySelectorAll('[style=""]').forEach(el => el.removeAttribute('style'));
  doc.querySelectorAll('[class=""]').forEach(el => el.removeAttribute('class'));
  assert.equal(doc.querySelector('.file-tree__items')!.innerHTML, before);
  adapter.dispose(); dom.window.close();
});
test('INL drag is intercepted before native physical move and rejects cross-scope drop', () => {
  const calls: unknown[] = [];
  const { dom, adapter, doc } = setup({ changeRole: (...args) => calls.push(args) });
  const groups = adapter.groups();
  adapter.present(groups.map(group => ({ group, projection: projectTree(group.nodes, { kind: 'root' }, true) })), false);
  let nativeDrops = 0;
  doc.querySelector('.file-tree')!.addEventListener('drop', () => nativeDrops++);
  const fire = (el: Element, type: string) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { setData() {}, effectAllowed: '', dropEffect: '' } });
    el.dispatchEvent(event);
  };
  fire(doc.querySelector('[data-node-id="a"]')!, 'dragstart');
  fire(doc.querySelector('.yzc-section[data-yzc-group="book/"][data-yzc-role="now"]')!, 'drop');
  assert.deepEqual(calls, [['book/', 'a', 'now']]); assert.equal(nativeDrops, 0);
  fire(doc.querySelector('[data-node-id="a"]')!, 'dragstart');
  fire(doc.querySelector('.yzc-section[data-yzc-group="book/a"]')!, 'drop');
  assert.equal(calls.length, 1); assert.equal(nativeDrops, 0);
  adapter.dispose(); dom.window.close();
});
test('tree replacement remounts exactly one local scope button and disabled state', async () => {
  let changes = 0;
  const { dom, adapter, doc } = setup({ refresh() { changes++; } });
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.equal(doc.querySelectorAll('.yzc-scope-toggle').length, 1);
  doc.body.innerHTML = markup;
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(doc.querySelectorAll('.yzc-scope-toggle').length, 1);
  assert.ok(changes >= 2);
  doc.querySelector('[data-node-id="a"]')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(adapter.current(), 'a');
  adapter.scopeState('a', true);
  assert.equal(doc.querySelector('.yzc-scope-toggle')!.getAttribute('aria-pressed'), 'true');
  doc.querySelector('[data-node-id="a"]')!.classList.add('b3-list-item--focus');
  doc.querySelector('[data-type="navigation-root"]')!.dispatchEvent(new dom.window.MouseEvent('click', {bubbles:true}));
  assert.equal(adapter.current(), 'notebook:book');
  adapter.dispose();
  assert.equal(doc.querySelectorAll('.yzc-scope-toggle').length, 0);
  dom.window.close();
});
test('controller persists opt-in, metadata-only drop and normal creation without touching ordinary scope', async () => {
  const { dom, adapter, doc } = setup();
  const data: Record<string, Record<string,string>> = { a: {}, b: {}, c: {}, d: {} };
  const writes: unknown[] = [];
  const storage = new InlStorage({ async getAttributes(id) { return data[id] ?? {}; }, async setAttributes(id, attrs) { writes.push({id,attrs}); data[id] = {...data[id],...attrs}; } });
  const errors: unknown[] = [];
  const controller = new InlController(adapter, storage, error => errors.push(error));
  doc.querySelector('[data-node-id="a"]')!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles:true }));
  await controller.toggleScope();
  assert.equal(data.a['custom-inl-scope'], 'true');
  controller.configure(true, true); await controller.refresh();
  assert.equal(doc.querySelectorAll('.yzc-section').length, 6);
  assert.equal(doc.querySelectorAll('[data-yzc-scope-id="root"]').length,1);
  await controller.changeRole('book/a', 'c', 'now');
  assert.equal(data.c[roleAttribute('book/a')], 'now');
  await assert.rejects(controller.changeRole('book/a', 'b', 'now'), /同一目录/);
  controller.configure(false, true);
  assert.equal(doc.querySelectorAll('.yzc-section').length, 0);
  controller.created({ id:'d', parentId:'b', notebook:'book' });
  await controller.toggleScope(); // drains creation queue, toggles a off
  assert.equal(data.d['custom-inl-role'], undefined);
  assert.ok(writes.every((w: any) => Object.keys(w.attrs).every(k => k.startsWith('custom-inl-'))));
  controller.dispose(); adapter.dispose(); dom.window.close();
});
test('create event decoder accepts actual 3.8.6 box objects and ignores refresh', () => {
  assert.deepEqual(decodeCreation({cmd:'create',data:{box:{id:'book'},path:'/a/b.sy'}}), {id:'b',parentId:'a',notebook:'book'});
  assert.equal(decodeCreation({cmd:'refresh',data:{box:{id:'book'},path:'/a/b.sy'}}),undefined);
});

test('closed notebook without loaded children does not receive empty sections', () => {
  const { dom, adapter, doc } = setup();
  doc.querySelector('.file-tree__items')!.insertAdjacentHTML('beforeend', '<ul data-url="closed"><li data-type="navigation-root" data-count="0"></li></ul>');
  assert.equal(adapter.groups().some(g => g.notebook === 'closed'), false);
  adapter.dispose(); dom.window.close();
});

test('external native drops cannot move a document into an INL list', () => {
  const { dom, adapter, doc } = setup();
  const groups = adapter.groups();
  adapter.present(groups.map(group => ({ group, projection: projectTree(group.nodes, {kind:'root'}, true) })), false);
  let nativeDrops = 0;
  doc.querySelector('.file-tree')!.addEventListener('drop', () => nativeDrops++);
  const event = new dom.window.Event('drop', {bubbles:true,cancelable:true});
  doc.querySelector('[data-node-id="a"]')!.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true); assert.equal(nativeDrops, 0);
  adapter.dispose(); dom.window.close();
});

test('explicit section create wins over native Inbox event and Normal opted-in creation uses Inbox', async () => {
  const { dom, adapter } = setup();
  const data: Record<string, Record<string,string>> = {a:{'custom-inl-scope':'true'}};
  const storage = new InlStorage({async getAttributes(id) {return data[id] ?? {};}, async setAttributes(id, attrs) {data[id] = {...data[id],...attrs};}});
  const controller = new InlController(adapter, storage, () => {});
  controller.configure(true,false);
  const group = adapter.groups().find(g => g.parentId === 'a')!;
  await controller.create(group, 'now', async () => {controller.created({id:'new',parentId:'a',notebook:'book'}); return 'new';});
  controller.configure(false,false);
  controller.created({id:'normal',parentId:'a',notebook:'book'});
  // Draining the mutation queue also exercises toggling a previously enabled scope.
  await controller.changeRole('book/a','c','library');
  assert.equal(data.new[roleAttribute('book/a')],'now');
  assert.equal(data.normal[roleAttribute('book/a')],'inbox');
  controller.dispose(); adapter.dispose(); dom.window.close();
});

test('controller ignores delayed reads after OFF and after unload', async () => {
  const { dom, adapter, doc } = setup();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const storage = new InlStorage({async getAttributes() {await gate; return {};}, async setAttributes() {}});
  const controller = new InlController(adapter, storage, () => {});
  controller.configure(true,false);
  controller.configure(false,false);
  release(); await controller.refresh();
  assert.equal(doc.querySelectorAll('.yzc-section').length,0);
  controller.configure(true,false); controller.dispose();
  await new Promise(resolve => setTimeout(resolve,0));
  assert.equal(doc.querySelectorAll('.yzc-section').length,0);
  adapter.dispose(); dom.window.close();
});

test('local scope requires an explicit tree selection and never falls back after removal', () => {
  const {dom,adapter,doc} = setup();
  doc.querySelector('[data-node-id="a"]')!.classList.add('b3-list-item--focus');
  assert.equal(adapter.current(),undefined);
  doc.querySelector('[data-node-id="c"]')!.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
  assert.equal(adapter.current(),'c');
  doc.querySelector('[data-node-id="c"]')!.remove();
  assert.equal(adapter.current(),undefined);
  adapter.dispose(); dom.window.close();
});

test('local sections live in A child list with one instance per scope through repeated rerenders', () => {
  const {dom,adapter,doc} = setup();
  // Simulate a second native representation of the same notebook and nodes.
  doc.body.insertAdjacentHTML('beforeend',markup);
  const a = [...doc.querySelectorAll<HTMLElement>('[data-node-id="a"]')].at(-1)!;
  for (let i=0;i<5;i++) {
    const groups=adapter.groups();
    assert.equal(groups.filter(g=>g.parentId === 'a').length,1);
    adapter.present(groups.map(group=>({group,projection:projectTree(group.nodes, group.parentId ? {kind:'document',id:group.parentId,enabled:group.parentId==='a'} : {kind:'root'},true)})),true);
    const lists=doc.querySelectorAll('[data-yzc-scope-id="book/a"]');
    assert.equal(lists.length,1);
    assert.equal(lists[0],a.nextElementSibling);
    assert.equal(lists[0].parentElement,a.parentElement);
    assert.equal(lists[0].getAttribute('data-yzc-parent-id'),'a');
    assert.equal(lists[0].querySelectorAll(':scope > .yzc-section').length,3);
    assert.equal(a.parentElement!.querySelectorAll(':scope > .yzc-section[data-yzc-group="book/a"]').length,0);
    assert.equal(doc.querySelectorAll('.yzc-section[data-yzc-group="book/a"]').length,3);
  }
  adapter.restore(); assert.equal(doc.querySelectorAll('[data-yzc-scope-id],.yzc-section').length,0);
  adapter.dispose(); dom.window.close();
});

test('enabling a selected child writes its own scope, never its parent or open document', async () => {
  const {dom,adapter,doc}=setup();
  const writes: {id:string;attrs:Record<string,string>}[]=[];
  const storage=new InlStorage({async getAttributes() {return {};},async setAttributes(id,attrs) {writes.push({id,attrs});}});
  const controller=new InlController(adapter,storage,()=>{});
  doc.querySelector('[data-node-id="a"]')!.classList.add('b3-list-item--focus');
  await controller.toggleScope(); assert.equal(writes.length,0);
  doc.querySelector('[data-node-id="c"]')!.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
  await controller.toggleScope();
  assert.deepEqual(writes,[{id:'c',attrs:{'custom-inl-scope':'true'}}]);
  controller.dispose(); adapter.dispose(); dom.window.close();
});


test('global INL projects Root plus opted-in Local scopes once, preserving roles across rerenders and mode changes', async () => {
  const {dom,adapter,doc}=setup();
  doc.querySelector('.file-tree__items')!.insertAdjacentHTML('beforeend','<ul data-url="two"><li data-type="navigation-root"></li></ul>');
  const controller=new InlController(adapter,new InlStorage({async getAttributes(id):Promise<Record<string,string>>{return id==='a'?{'custom-inl-scope':'true'}:{};},async setAttributes(){}}),()=>{});
  controller.configure(true,false); await controller.refresh();
  assert.equal(doc.querySelectorAll('.yzc-section').length,6);
  assert.equal(doc.querySelectorAll('[data-yzc-scope-id="root"]').length,1);
  assert.equal(doc.querySelectorAll('.yzc-section[data-yzc-group="book/"]').length,0);
  const library=doc.querySelector<HTMLElement>('.yzc-section[data-yzc-group="book/a"][data-yzc-role="library"] button')!;
  assert.equal(library.textContent,'LIBRARY  1');
  assert.equal(library.getAttribute('aria-expanded'),'false');
  assert.equal(doc.querySelector('[data-yzc-role="inbox"] button')!.getAttribute('aria-expanded'),'false');
  assert.ok(!/[⌄›]/.test(doc.querySelector('.file-tree__items')!.textContent!));
  library.click(); await controller.refresh();
  assert.equal(library.getAttribute('aria-expanded'),'true');
  const root=doc.querySelector('[data-yzc-scope-id="root"]');
  for(let i=0;i<10;i++) {controller.repaint();await controller.refresh();}
  assert.equal(library.getAttribute('aria-expanded'),'true');
  assert.equal(doc.querySelector('[data-yzc-scope-id="root"]'),root);
  for(const scope of ['root','book/a'])assert.equal(doc.querySelectorAll(`.yzc-section[data-yzc-group="${scope}"]`).length,3);
  controller.configure(false,false); controller.configure(true,false); await controller.refresh();
  assert.equal(doc.querySelector('[data-yzc-role="library"] button')!.getAttribute('aria-expanded'),'false');
  controller.dispose(); adapter.dispose(); dom.window.close();
});

test('crowded hint exists exactly at six Now items with no hard cap', () => {
  const {dom,adapter,doc}=setup();
  const root=doc.querySelector('.file-tree__items')!;
  for(let i=0;i<6;i++) root.insertAdjacentHTML('beforeend',`<ul data-url="book${i}"><li data-type="navigation-root"></li></ul>`);
  for(const count of [5,6,7,4]) {
    const groups=adapter.groups();
    adapter.present(groups.map(group=>{const nodes=group.nodes.map((n,i)=>({...n,role:(i<count?'now':'library') as 'now'|'library'}));return {group:{...group,nodes},projection:projectTree(nodes,{kind:'root'},group.key==='root')};}),false);
    assert.equal(doc.querySelectorAll('.yzc-crowded').length,count>=6?1:0);
    assert.equal(doc.querySelectorAll('.yzc-section').length,3);
  }
  const render=()=>{const groups=adapter.groups();adapter.present(groups.map(group=>{const nodes=group.nodes.map(n=>({...n,role:'now' as const}));return {group:{...group,nodes},projection:projectTree(nodes,{kind:'root'},group.key==='root')};}),false);};
  render();
  assert.equal(doc.querySelectorAll('.yzc-crowded[data-yzc-role="now"]').length,1);
  (doc.querySelector('[data-yzc-role="now"] button') as HTMLElement).click();render();
  assert.equal(doc.querySelectorAll('.yzc-crowded').length,0,'collapsed Now owns no hint DOM');
  (doc.querySelector('[data-yzc-role="now"] button') as HTMLElement).click();render();
  assert.equal(doc.querySelectorAll('.yzc-crowded').length,1);
  adapter.dispose();dom.window.close();
});

test('projection identity survives refresh; orphan clones and replaced scope mounts are removed', () => {
  const {dom,adapter,doc}=setup();
  const render=()=>{const groups=adapter.groups();adapter.present(groups.map(group=>({group,projection:projectTree(group.nodes,{kind:'root'},group.key==='book/a' || group.key==='book/b')})),false);};
  render();
  const list=doc.querySelector<HTMLElement>('[data-yzc-scope-id="book/a"]')!;
  const header=list.querySelector('.yzc-section')!;
  const empty=doc.querySelector('[data-yzc-scope-id="book/b"]')!;
  for(let i=0;i<10;i++){render();assert.equal(list.querySelector('.yzc-section'),header);assert.equal(doc.querySelector('[data-yzc-scope-id="book/b"]'),empty);}
  // Simulate a host clone carrying stale custom nodes, not an intentional scope.
  const clone=header.cloneNode(true) as HTMLElement;doc.body.append(clone);
  const ghost=doc.createElement('ul');ghost.className='yzc-empty-list';ghost.append(header.cloneNode(true));doc.body.append(ghost);
  render();assert.equal(clone.isConnected,false);assert.equal(ghost.isConnected,false);
  const replacement=doc.createElement('ul');replacement.innerHTML='<li data-type="navigation-file" data-node-id="c" data-count="0"></li>';
  list.replaceWith(replacement);render();
  assert.equal(header.isConnected,false);assert.equal(replacement.querySelectorAll('.yzc-section').length,3);
  assert.equal(doc.querySelectorAll('[data-yzc-scope-id="book/a"]').length,1);
  doc.querySelector('[data-node-id="b"]')!.remove();render();
  assert.equal(empty.isConnected,false,'synthetic child list cannot survive removal of its exact owner');
  adapter.restore();
  assert.equal(doc.querySelectorAll('.yzc-section,.yzc-empty-list,.yzc-crowded,[data-yzc-scope-id]').length,0);
  assert.equal(doc.querySelectorAll('[style*="--yzc-tree-depth"]').length,0);
  adapter.dispose();dom.window.close();
});

test('title click toggles native children and preserves document opening; notebook title only toggles', async () => {
  const {dom,adapter,doc}=setup();let opens=0,toggles=0,notebookNavigations=0;const order:string[]=[];
  const row=doc.querySelector<HTMLElement>('[data-node-id="a"]')!;
  row.insertAdjacentHTML('afterbegin','<span class="b3-list-item__toggle"><svg class="b3-list-item__arrow"></svg></span>');
  row.querySelector('.b3-list-item__toggle')!.addEventListener('click',()=>{order.push('expand');toggles++;row.querySelector('svg')!.classList.toggle('b3-list-item__arrow--open');});
  row.querySelector('.b3-list-item__text')!.addEventListener('click',()=>{order.push('open');opens++;});
  (row.querySelector('.b3-list-item__text') as HTMLElement).click();
  await Promise.resolve();
  assert.equal(opens,1);assert.equal(toggles,1);assert.ok(row.querySelector('.b3-list-item__arrow--open'));
  assert.deepEqual(order,['open','expand'],'original navigation must finish before native expansion can replace the clicked row');
  (row.querySelector('.b3-list-item__text') as HTMLElement).click();await Promise.resolve();assert.equal(opens,2);assert.equal(toggles,2);
  const notebook=doc.querySelector('[data-type="navigation-root"]')!;
  notebook.innerHTML='<span class="b3-list-item__toggle"></span><span class="b3-list-item__text">Book</span>';
  notebook.querySelector('.b3-list-item__toggle')!.addEventListener('click',()=>toggles++);
  notebook.querySelector('.b3-list-item__text')!.addEventListener('click',()=>notebookNavigations++);
  (notebook.querySelector('.b3-list-item__text') as HTMLElement).click();
  assert.equal(toggles,3);assert.equal(notebookNavigations,0);assert.equal(adapter.current(),'notebook:book');
  adapter.dispose();dom.window.close();
});

test('whole-row primary clicks activate the title once while controls and modified clicks stay native', async () => {
  const {dom,adapter,doc}=setup();let opens=0,toggles=0,controls=0;
  const row=doc.querySelector<HTMLElement>('[data-node-id="a"]')!;
  row.insertAdjacentHTML('afterbegin','<span class="b3-list-item__toggle"></span>');
  row.insertAdjacentHTML('beforeend','<span class="yzc-child-count">7</span><span class="row-space"></span><span class="b3-list-item__action"></span><span class="b3-list-item__icon"></span><span class="b3-list-item__switch"></span>');
  row.querySelector<HTMLElement>('.b3-list-item__text')!.onclick=()=>{opens++;};
  row.querySelector<HTMLElement>('.b3-list-item__toggle')!.onclick=()=>{toggles++;};
  for(const selector of ['.b3-list-item__action','.b3-list-item__icon','.b3-list-item__switch'])
    row.querySelector<HTMLElement>(selector)!.onclick=()=>{controls++;};
  for(const target of [row,row.querySelector<HTMLElement>('.yzc-child-count')!,row.querySelector<HTMLElement>('.row-space')!]) {
    target.click();await Promise.resolve();
  }
  assert.equal(opens,3);assert.equal(toggles,3);
  for(const selector of ['.b3-list-item__action','.b3-list-item__icon','.b3-list-item__switch'])
    row.querySelector<HTMLElement>(selector)!.click();
  row.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,ctrlKey:true}));
  row.dispatchEvent(new dom.window.MouseEvent('contextmenu',{bubbles:true}));
  assert.equal(opens,3);assert.equal(toggles,3);assert.equal(controls,3);
  const notebook=doc.querySelector<HTMLElement>('[data-type="navigation-root"]')!;
  notebook.innerHTML='<span class="b3-list-item__toggle"></span><span class="b3-list-item__text">Book</span>';
  notebook.querySelector<HTMLElement>('.b3-list-item__toggle')!.onclick=()=>{toggles++;};
  notebook.click();
  assert.equal(toggles,4);assert.equal(adapter.current(),'notebook:book');
  adapter.dispose();dom.window.close();
});

test('known Local INL repaints a replacement child list before timers or metadata reads', async () => {
  let controller: InlController | undefined;
  const {dom,adapter,doc}=setup({repaint:()=>controller?.repaint()});
  let reads=0;
  const storage=new InlStorage({async getAttributes(id):Promise<Record<string,string>>{reads++;return id==='a'?{'custom-inl-scope':'true'}:id==='c'?{[roleAttribute('book/a')]:'now'}:{};},async setAttributes(){}});
  controller=new InlController(adapter,storage,()=>{});
  controller.configure(true,false);await controller.refresh();
  const beforeReads=reads;
  const parent=doc.querySelector('[data-node-id="a"]')!;
  parent.nextElementSibling!.outerHTML='<ul><li data-type="navigation-file" data-node-id="c" data-count="0"><span class="b3-list-item__text">日期复盘</span></li></ul>';
  await Promise.resolve(); // MutationObserver delivery; no timer and no network completion.
  const list=parent.nextElementSibling!;
  assert.equal(reads,beforeReads);
  assert.equal(list.querySelectorAll('.yzc-section').length,3);
  assert.equal(list.querySelector('[data-node-id="c"]')!.classList.contains('yzc-role-hidden'),false);
  assert.equal(list.querySelector('[data-yzc-role="now"] button')!.textContent,'NOW  1');
  assert.equal(list.classList.contains('yzc-inl-pending'),false);
  assert.equal((list as HTMLElement).style.getPropertyValue('--yzc-content-inset'),'52px');
  controller.dispose();adapter.dispose();dom.window.close();
});

test('first expansion of a known scope commits new children with sections, ordinary scopes stay native', async () => {
  let controller:InlController|undefined;
  const {dom,adapter,doc}=setup({repaint:()=>controller?.repaint()});
  const parent=doc.querySelector('[data-node-id="a"]')!;
  parent.nextElementSibling!.remove();
  const storage=new InlStorage({async getAttributes(id):Promise<Record<string,string>>{return id==='a'?{'custom-inl-scope':'true'}:{};},async setAttributes(){}});
  controller=new InlController(adapter,storage,()=>{});
  controller.configure(true,false);await controller.refresh();
  parent.insertAdjacentHTML('afterend','<ul><li data-type="navigation-file" data-node-id="new" data-count="0"></li></ul>');
  await Promise.resolve();
  const list=parent.nextElementSibling!;
  assert.equal(list.classList.contains('yzc-inl-pending'),true);
  assert.equal(doc.querySelector('[data-node-id="b"]')!.parentElement!.classList.contains('yzc-inl-pending'),false);
  await controller.refresh();
  assert.equal(list.classList.contains('yzc-inl-pending'),false);
  assert.equal(list.querySelectorAll('.yzc-section').length,3);
  assert.equal(list.querySelector('[data-node-id="new"]')!.classList.contains('yzc-role-hidden'),true); // Library is collapsed.
  controller.configure(false,false);
  assert.equal(doc.querySelectorAll('.yzc-inl-pending,.yzc-section,.yzc-role-hidden').length,0);
  controller.dispose();adapter.dispose();dom.window.close();
});

test('empty selected local scope follows its owner in projected order and parent section visibility', () => {
  const {dom,adapter,doc}=setup();
  const render=()=>{
    const groups=adapter.groups();
    adapter.present(groups.map(group=>({group,projection:projectTree(group.nodes,{kind:'root'},group.key==='book/' || group.key==='book/b')})),false);
  };
  render();
  const owner=doc.querySelector<HTMLElement>('[data-node-id="b"]')!;
  let list=owner.nextElementSibling as HTMLElement;
  assert.equal(list.dataset.yzcParentId,'b');
  assert.equal(Number(list.style.order),Number(owner.style.order)+1);
  assert.ok(list.classList.contains('yzc-role-hidden')); // Library starts closed.
  doc.querySelector<HTMLButtonElement>('.yzc-section[data-yzc-group="book/"][data-yzc-role="library"] button')!.click();
  render();list=owner.nextElementSibling as HTMLElement;
  assert.equal(Number(list.style.order),Number(owner.style.order)+1);
  assert.equal(list.classList.contains('yzc-role-hidden'),false);
  assert.equal(doc.querySelectorAll('[data-yzc-scope-id="book/b"]').length,1);
  adapter.restore();assert.notEqual(owner.nextElementSibling?.tagName,'UL');
  adapter.dispose();dom.window.close();
});

test('native outline is excluded from local INL selection and button mounting', async () => {
  const {dom,adapter,doc}=setup();
  doc.body.insertAdjacentHTML('beforeend','<div class="file-tree sy__outline"><div class="block__icons"></div><li data-type="navigation-file" data-node-id="outline-only"></li></div>');
  await new Promise(resolve=>setTimeout(resolve,150));
  assert.equal(doc.querySelectorAll('.sy__outline .yzc-scope-toggle').length,0);
  doc.querySelector('[data-node-id="outline-only"]')!.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));
  assert.equal(adapter.current(),undefined);
  adapter.dispose();dom.window.close();
});

test('focus shares native nodes, scopes and roles; drilldown/back and OFF preserve location',async()=>{
  let controller:InlController|undefined;
  const {dom,adapter,doc}=setup({refresh:()=>{void controller?.refresh();},repaint:()=>controller?.repaint()});
  const book=doc.querySelector<HTMLElement>('[data-type="navigation-root"]')!;
  book.innerHTML='<span class="b3-list-item__text">Book</span>';
  const writes:unknown[]=[];
  const attrs:Record<string,Record<string,string>>={
    'notebook:book':{'custom-inl-scope':'true'},a:{'custom-inl-scope':'true'},
    c:{[roleAttribute('book/a')]:'now'}
  };
  const storage=new InlStorage({async getAttributes(id){return attrs[id]??{};},async setAttributes(id,patch){writes.push([id,patch]);attrs[id]={...attrs[id],...patch};}},
    {async read(){return {enabled:true};},async write(){}});
  controller=new InlController(adapter,storage,()=>{});
  controller.configure(true,false);await controller.refresh();
  const original=doc.querySelector('[data-node-id="c"]');
  adapter.configureFocus(true);await controller.refresh();
  assert.equal(doc.querySelectorAll('.yzc-section').length,3);
  assert.equal(doc.querySelector('[data-yzc-scope-id]')!.getAttribute('data-yzc-scope-id'),'root');
  assert.equal(doc.querySelector('.yzc-focus-title')!.textContent,'全部文档');
  assert.equal((doc.querySelector('.yzc-focus-back') as HTMLButtonElement).disabled,true);
  (book.querySelector('.b3-list-item__text') as HTMLElement).click();await controller.refresh();
  assert.equal(doc.querySelector('.yzc-focus-title')!.textContent,'Book');
  assert.equal(doc.querySelectorAll('.yzc-section').length,3);
  const header=doc.querySelector('.yzc-focus-title');
  (doc.querySelector('[data-node-id="a"] .b3-list-item__text') as HTMLElement).click();await controller.refresh();
  assert.equal(doc.querySelector('.yzc-focus-title'),header);
  assert.equal(header!.textContent,'项目');
  assert.equal(doc.querySelector('.yzc-focus-crumb')!.textContent,'全部文档 / Book / 项目');
  assert.equal(doc.querySelectorAll('[data-yzc-scope-id]').length,1);
  assert.equal(doc.querySelector('[data-node-id="c"]'),original);
  assert.equal(writes.length,0,'view changes never write role/parent/path data');
  await controller.changeRole('book/a','c','library');
  assert.equal(attrs.c[roleAttribute('book/a')],'library');
  adapter.configureFocus(false);await controller.refresh();
  assert.equal(adapter.current(),'a');
  assert.equal(doc.querySelectorAll('.yzc-focus-title,.yzc-focus-path').length,0);
  assert.equal(doc.querySelector('[data-node-id="c"]')!.classList.contains('yzc-role-hidden'),true);
  adapter.configureFocus(true);await controller.refresh();
  assert.equal(doc.querySelector('.yzc-focus-title')!.textContent,'项目');
  (doc.querySelector('.yzc-focus-back') as HTMLElement).click();await controller.refresh();
  assert.equal(doc.querySelector('.yzc-focus-title')!.textContent,'Book');
  (doc.querySelector('.yzc-focus-back') as HTMLElement).click();await controller.refresh();
  assert.equal(doc.querySelector('.yzc-focus-title')!.textContent,'全部文档');
  controller.dispose();adapter.dispose();
  assert.equal(doc.querySelectorAll('.yzc-focus-tree,.yzc-focus-title,.yzc-focus-back,.yzc-focus-crumb,.yzc-focus-path,.yzc-section').length,0);
  dom.window.close();
});

test('focus on a non-INL scope remains a normal list, rerender reuses header without duplicate projections',async()=>{
  let controller:InlController|undefined;
  const {dom,adapter,doc}=setup({refresh:()=>{void controller?.refresh();},repaint:()=>controller?.repaint()});
  controller=new InlController(adapter,new InlStorage({async getAttributes(){return {};},async setAttributes(){throw Error('View must not write');}}),()=>{});
  controller.configure(true,false);await controller.refresh();
  (doc.querySelector('[data-node-id="a"] .b3-list-item__text') as HTMLElement).click();
  adapter.configureFocus(true);await controller.refresh();
  assert.equal(doc.querySelector('.yzc-focus-title')!.textContent,'项目');
  assert.equal(doc.querySelectorAll('.yzc-section').length,0);
  const header=doc.querySelector('.yzc-focus-title');
  doc.querySelector('.block__icons')!.outerHTML='<div class="block__icons"><span class="block__logo">文档</span></div>';
  await controller.refresh();
  assert.equal(doc.querySelector('.yzc-focus-title'),header,'host header replacement reattaches the existing focus shell');
  assert.equal(header!.parentElement,doc.querySelector('.block__icons'));
  doc.querySelector('[data-node-id="c"]')!.outerHTML='<li data-type="navigation-file" data-node-id="new" data-count="0"><span class="b3-list-item__text">Replacement</span></li>';
  for(let i=0;i<10;i++){await controller.refresh();assert.equal(doc.querySelector('.yzc-focus-title'),header);}
  assert.equal(doc.querySelectorAll('.yzc-focus-current').length,1);
  assert.ok(doc.querySelector('[data-node-id="new"]')!.parentElement!.classList.contains('yzc-focus-current'));
  adapter.configureFocus(false);controller.configure(false,false);await controller.refresh();
  assert.equal(doc.querySelectorAll('.yzc-focus-title,.yzc-section').length,0);
  controller.dispose();adapter.dispose();dom.window.close();
});
