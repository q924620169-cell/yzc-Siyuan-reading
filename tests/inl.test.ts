import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTree, roleForNewDocument, type TreeNode } from '../plugin/src/inl/inl-tree';
import { InlManager } from '../plugin/src/inl/inl-manager';
import { InlStorage, roleAttribute } from '../plugin/src/inl/inl-storage';
import { SiYuanAttributeAdapter } from '../plugin/src/inl/inl-adapter';
import { normalizeSettings } from '../plugin/src/settings';

const nodes: readonly TreeNode[] = Object.freeze([
  Object.freeze({ id: 'a', name: '日期复盘' }),
  Object.freeze({ id: 'b', name: '当前项目', role: 'now' as const }),
  Object.freeze({ id: 'c', name: '阅读' }),
]);
test('OFF and non-opted-in scopes preserve native array and order', () => {
  assert.deepEqual(projectTree(nodes, { kind: 'root' }, false), { mode: 'normal', nodes });
  const result = projectTree(nodes, { kind: 'document', id: 'a', enabled: false }, true);
  assert.equal(result.mode, 'normal');
  if (result.mode === 'normal') assert.equal(result.nodes, nodes);
});
test('INL is a stable, unique projection; historical unassigned nodes fall back to Library', () => {
  const result = projectTree(nodes, { kind: 'root' }, true);
  assert.equal(result.mode, 'inl');
  if (result.mode !== 'inl') return;
  assert.deepEqual(result.sections.map(section => section.nodes.map(node => node.id)), [['b'], ['a', 'c'], []]);
  assert.equal(result.sections[1].collapsed, true);
  assert.equal(new Set(result.sections.flatMap(section => section.nodes.map(node => node.id))).size, nodes.length);
  assert.equal(nodes[0].role, undefined);
});
test('creation role is scoped, explicit section wins, normal creation in enabled scope uses Inbox', () => {
  assert.equal(roleForNewDocument({ kind: 'root' }), 'inbox');
  assert.equal(roleForNewDocument({ kind: 'root' }, 'now'), 'now');
  assert.equal(roleForNewDocument({ kind: 'document', id: 'a', enabled: false }), undefined);
  assert.equal(roleForNewDocument({ kind: 'document', id: 'a', enabled: true }), 'inbox');
});
test('role changes write only custom attributes and surface API errors', async () => {
  const calls: unknown[] = [];
  const storage = new InlStorage(new SiYuanAttributeAdapter(async (path, body) => {
    calls.push({ path, body }); return { code: 0, data: null };
  }));
  await storage.setRole('scope-a', 'doc', 'library');
  assert.deepEqual(calls, [{ path: '/api/attr/setBlockAttrs', body: { id: 'doc', attrs: { [roleAttribute('scope-a')]: 'library' } } }]);
  const bad = new InlStorage(new SiYuanAttributeAdapter(async () => ({ code: -1, msg: 'read only' })));
  await assert.rejects(bad.setScope('doc', true), /read only/);
});
test('corrupted API data is rejected; unknown roles do not become valid metadata', async () => {
  const bad = new SiYuanAttributeAdapter(async () => ({ code: 0, data: [] }));
  await assert.rejects(bad.getAttributes('doc'), /Invalid/);
  const storage = new InlStorage(new SiYuanAttributeAdapter(async () => ({ code: 0, data: { 'custom-inl-role': 'other' } })));
  assert.deepEqual(await storage.read('doc'), { enabled: false, role: undefined });
});
test('failed view switch restores native tree; later switches still run', async () => {
  let restored = 0;
  const manager = new InlManager({
    async readChildren() { return nodes; },
    async replaceView() { throw new Error('mount failed'); },
    restore() { restored++; },
  });
  await assert.rejects(manager.switchView(true, { kind: 'root' }), /mount failed/);
  await manager.switchView(false, { kind: 'root' });
  assert.equal(restored, 2);
});
test('a delayed ON cannot outlive a queued OFF', async () => {
  const events: string[] = [];
  const manager = new InlManager({
    async readChildren() { await new Promise(resolve => setTimeout(resolve, 5)); return nodes; },
    async replaceView() { events.push('inl'); },
    restore() { events.push('native'); },
  });
  await Promise.all([manager.switchView(true, { kind: 'root' }), manager.switchView(false, { kind: 'root' })]);
  assert.deepEqual(events, ['inl', 'native']);
});
test('unload during pending read cannot mount a stale INL view', async () => {
  let release!: (value: readonly TreeNode[]) => void;
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  let mounted = false;
  const manager = new InlManager({
    readChildren() { started(); return new Promise(resolve => { release = resolve; }); },
    async replaceView() { mounted = true; }, restore() {},
  });
  const work = manager.switchView(true, { kind: 'root' });
  await start; manager.dispose(); release(nodes); await work;
  assert.equal(mounted, false);
});
test('settings validate persisted values and keep the three dimensions separate', () => {
  assert.deepEqual(normalizeSettings({ style: 'bad', inlEnabled: 'false', coloredHeadings: 1 }), normalizeSettings(null));
  const settings = normalizeSettings({ style: 'anthropic', inlEnabled: true });
  assert.equal(settings.style, 'anthropic'); assert.equal(settings.inlEnabled, true);
  assert.equal(settings.coloredTree, false);
});

test('all style and typography combinations persist independently', () => {
  for (const style of ['notion','anthropic']) for (const typography of ['notion','anthropic']) {
    const saved = normalizeSettings({style,typography});
    assert.equal(saved.style,style); assert.equal(saved.typography,typography);
    assert.deepEqual(normalizeSettings(JSON.parse(JSON.stringify(saved))),saved);
    const changedStyle = normalizeSettings({...saved,style:'notion'});
    assert.equal(changedStyle.typography,typography);
    const changedType = normalizeSettings({...saved,typography: typography === 'notion' ? 'anthropic' : 'notion'});
    assert.equal(changedType.style,style);
  }
  assert.equal(normalizeSettings({style:'anthropic'}).typography,'notion');
  assert.equal(normalizeSettings({typography:'invalid'}).typography,'notion');
});


test('roles belong to scope and legacy role does not leak into unrelated scopes', async () => {
  const data: Record<string,Record<string,string>>={doc:{'custom-inl-role':'now'}};
  const storage=new InlStorage({async getAttributes(id){return data[id]??{};},async setAttributes(id,attrs){data[id]={...data[id],...attrs};}});
  assert.equal((await storage.read('doc','a')).role,undefined);
  await storage.setRole('a','doc','now'); await storage.setRole('b','doc','library');
  assert.equal((await storage.read('doc','a')).role,'now');
  assert.equal((await storage.read('doc','b')).role,'library');
  assert.equal((await storage.read('doc','c')).role,undefined);
  assert.notEqual(roleAttribute('a/b'),roleAttribute('a-b'));
});

test('notebook root role and its local enable flag persist independently', async () => {
  const data: Record<string,any>={};
  const adapter={async getAttributes(){throw new Error('Notebook must not call block API');},async setAttributes(){throw new Error('Notebook must not call block API');}};
  const store={async read(id:string){return data[id]??{};},async write(id:string,value:any){data[id]=value;}};
  const first=new InlStorage(adapter,store);
  await first.setRole('root','notebook:book','library'); await first.setScope('notebook:book',true);
  const restored=new InlStorage(adapter,store);
  assert.deepEqual(await restored.read('notebook:book','root'),{enabled:true,role:'library'});
  assert.equal((await restored.read('notebook:book','other')).role,undefined);
});
