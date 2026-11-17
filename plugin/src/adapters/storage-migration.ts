const OLD_ID = 'yzc-INL-plus';
const NEW_ID = 'yzc-INL';
const ROOT = '/data/storage/petal';
const FILES = ['settings.json', 'windows.json', 'inl-notebooks.json'] as const;
const MARKER = 'identity-migration-v1.json';
type Entry = { name: string; isDir: boolean };

/** Official workspace APIs only. Copy absent destination files; never rewrite roles
 * or delete legacy storage. A Web Lock serializes concurrent desktop frontends. */
export async function migratePluginStorage(id: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<void> {
  if (id !== NEW_ID) return;
  const run = async () => {
    const post = async (url: string, body: BodyInit, headers?: HeadersInit) => {
      signal.throwIfAborted();
      const response = await request(url, { method: 'POST', body, headers, signal });
      if (!response.ok || response.status !== 200) throw new Error(`Storage API ${url}: HTTP ${response.status}`);
      return response.json();
    };
    const json = (url: string, value: unknown) => post(url, JSON.stringify(value), { 'Content-Type': 'application/json' });
    const list = async (path: string): Promise<Entry[]> => {
      const result = await json('/api/file/readDir', { path });
      if (result.code === 404) return [];
      if (result.code !== 0 || !Array.isArray(result.data)) throw new Error(result.msg || 'Cannot list plugin storage');
      return result.data;
    };
    const read = async (path: string) => {
      const value = await json('/api/file/getFile', { path });
      if (!value || typeof value !== 'object' || Array.isArray(value) || ('code' in value && 'msg' in value && 'data' in value))
        throw new Error(`Invalid plugin storage: ${path}`);
      return value;
    };
    const write = async (file: string, value: unknown) => {
      const form = new FormData();
      form.append('path', `${ROOT}/${NEW_ID}/${file}`); form.append('isDir', 'false');
      form.append('file', new Blob([JSON.stringify(value)], { type: 'application/json' }), file);
      const result = await post('/api/file/putFile', form);
      if (result.code !== 0) throw new Error(result.msg || `Cannot save ${file}`);
    };
    const directories = await list(ROOT);
    const destination = directories.some(e => e.isDir && e.name === NEW_ID) ? await list(`${ROOT}/${NEW_ID}`) : [];
    if (destination.some(e => e.name === MARKER && !e.isDir)) {
      const marker = await read(`${ROOT}/${NEW_ID}/${MARKER}`);
      if (marker.from === OLD_ID && marker.to === NEW_ID && marker.completed === true) return;
      throw new Error('Invalid identity migration marker');
    }
    const legacy = directories.some(e => e.isDir && e.name === OLD_ID) ? await list(`${ROOT}/${OLD_ID}`) : [];
    const pending: [string, unknown][] = [];
    // Preflight every source before the first write; invalid JSON is not silently
    // replaced by defaults, and an interrupted migration can retry absent files.
    for (const file of FILES) if (!destination.some(e => e.name === file) && legacy.some(e => e.name === file && !e.isDir))
      pending.push([file, await read(`${ROOT}/${OLD_ID}/${file}`)]);
    const copied: string[] = [];
    for (const [file, value] of pending) {
      if ((await list(`${ROOT}/${NEW_ID}`)).some(e => e.name === file)) continue;
      await write(file, value); copied.push(file);
    }
    await write(MARKER, { version: 1, from: OLD_ID, to: NEW_ID, completed: true, copied });
  };
  const locks = globalThis.navigator?.locks;
  if (locks) await locks.request('yzc-INL:identity-migration-v1', { signal }, run);
  else await run();
}
