import { fetchSyncPost, openTab, showMessage, type Plugin } from 'siyuan';
import { SiYuanAttributeAdapter } from '../inl/inl-adapter';

export async function kernel<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const result = await fetchSyncPost(path, body);
  if (result.code !== 0) throw new Error(result.msg || 'SiYuan API failed');
  return result.data as T;
}
export function attributes(): SiYuanAttributeAdapter { return new SiYuanAttributeAdapter(fetchSyncPost); }

export interface CreateLocation { notebook: string; parentId?: string }
export class DocumentApi {
  constructor(private plugin: Plugin) {}
  async countNotebook(notebook: string): Promise<number> {
    const data = await kernel<{files: {id: string}[]}>('/api/filetree/listDocsByPath', {notebook,path:'/',maxListCount:0,ignoreMaxListHint:true});
    return data.files.length;
  }
  async create(location: CreateLocation, title: string): Promise<string> {
    if (!title.trim() || /[\\/]/.test(title)) throw new Error('请输入不含 / 或 \\ 的文档名称');
    const parent = location.parentId ? await kernel<string>('/api/filetree/getHPathByID', { id: location.parentId }) : '';
    // Unique suffix avoids createDocWithMd resolving an existing same-name document.
    const name = `${title.trim()} ${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
    const id = await kernel<string>('/api/filetree/createDocWithMd', { notebook: location.notebook, path: `${parent}/${name}`, markdown: '' });
    try {
      const path = await kernel<{ notebook: string; path: string }>('/api/filetree/getPathByID', { id });
      await kernel('/api/filetree/renameDoc', { ...path, title: title.trim() });
    } catch {
      // The created document must still receive its role even if renaming failed.
      showMessage('yzc-INL：文档已创建，但标题整理失败；临时后缀已保留，可手动重命名。', 6000, 'error');
    }
    return id;
  }
  open(id: string): void { void openTab({ app: this.plugin.app, doc: { id } }); }
}
