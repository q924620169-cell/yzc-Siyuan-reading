import type { AttributeAdapter } from './inl-adapter';
import { isRole, SCOPE_ATTRIBUTE, type Role } from './inl-tree';
export interface NotebookMetadata { enabled?: boolean; roles?: Record<string, Role> }
export interface NotebookStore { read(id: string): Promise<NotebookMetadata>; write(id: string, data: NotebookMetadata): Promise<void> }
export function roleAttribute(scopeId: string): string {
  return `custom-inl-role-${Array.from(scopeId).map(c => c.codePointAt(0)!.toString(16).padStart(4,'0')).join('')}`;
}
export class InlStorage {
  constructor(private readonly adapter: AttributeAdapter, private readonly notebooks?: NotebookStore) {}
  async read(id: string, scopeId?: string): Promise<{enabled: boolean; role?: Role}> {
    if (id.startsWith('notebook:')) {
      const value = await this.notebooks?.read(id) ?? {};
      const role = scopeId ? value.roles?.[scopeId] : undefined;
      return {enabled: value.enabled === true, role: isRole(role) ? role : undefined};
    }
    const attrs = await this.adapter.getAttributes(id);
    const role = scopeId ? attrs[roleAttribute(scopeId)] : undefined;
    return {enabled: attrs[SCOPE_ATTRIBUTE] === 'true', role: isRole(role) ? role : undefined};
  }
  async setScope(id: string, enabled: boolean): Promise<void> {
    if (id.startsWith('notebook:')) {
      if (!this.notebooks) throw new Error('笔记本元数据存储不可用');
      await this.notebooks.write(id,{...await this.notebooks.read(id),enabled}); return;
    }
    await this.adapter.setAttributes(id,{[SCOPE_ATTRIBUTE]:String(enabled)});
  }
  async setRole(scopeId: string, id: string, role: Role): Promise<void> {
    if (!isRole(role)) throw new Error('Invalid INL role');
    if (id.startsWith('notebook:')) {
      if (!this.notebooks) throw new Error('笔记本元数据存储不可用');
      const value=await this.notebooks.read(id);
      await this.notebooks.write(id,{...value,roles:{...value.roles,[scopeId]:role}}); return;
    }
    await this.adapter.setAttributes(id,{[roleAttribute(scopeId)]:role});
  }
}
