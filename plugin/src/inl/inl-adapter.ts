import type { Projection, Scope, TreeNode } from './inl-tree';

/** Host-specific tree integration. Implement after inspecting the target SiYuan version.
 * replaceView must atomically replace the native region; restore must be idempotent.
 * No physical move/delete operation is exposed to the domain layer.
 */
export interface TreeAdapter {
  readChildren(scope: Scope): Promise<readonly TreeNode[]>;
  replaceView(projection: Projection): Promise<void>;
  restore(): void;
}

export interface AttributeAdapter {
  getAttributes(id: string): Promise<Record<string, string>>;
  setAttributes(id: string, attrs: Record<string, string>): Promise<void>;
}

export type KernelTransport = (path: string, body: Record<string, unknown>) => Promise<unknown>;

function responseData(response: unknown): unknown {
  if (!response || typeof response !== 'object' || !('code' in response)) {
    throw new Error('Invalid SiYuan API response');
  }
  const result = response as { code: unknown; msg?: string; data?: unknown };
  if (result.code !== 0) throw new Error(result.msg || 'SiYuan API request failed');
  return result.data;
}

/** Public kernel endpoints, with SDK/session authentication supplied by transport. */
export class SiYuanAttributeAdapter implements AttributeAdapter {
  constructor(private readonly post: KernelTransport) {}
  async getAttributes(id: string): Promise<Record<string, string>> {
    const data = responseData(await this.post('/api/attr/getBlockAttrs', { id }));
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        Object.values(data).some(value => typeof value !== 'string')) {
      throw new Error('Invalid SiYuan attributes');
    }
    return data as Record<string, string>;
  }
  async setAttributes(id: string, attrs: Record<string, string>): Promise<void> {
    responseData(await this.post('/api/attr/setBlockAttrs', { id, attrs }));
  }
}
