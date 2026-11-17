export const ROLES = ['now', 'library', 'inbox'] as const;
export type Role = typeof ROLES[number];
export const SCOPE_ATTRIBUTE = 'custom-inl-scope';
export const ROLE_ATTRIBUTE = 'custom-inl-role';
export type Scope = { kind: 'root' } | { kind: 'document'; id: string; enabled: boolean };
export interface TreeNode {
  id: string;
  name: string;
  role?: Role;
}
export type Projection =
  | { mode: 'normal'; nodes: readonly TreeNode[] }
  | { mode: 'inl'; sections: { role: Role; nodes: TreeNode[]; collapsed: boolean }[] };
export function isRole(value: unknown): value is Role {
  return ROLES.includes(value as Role);
}
export function isScopeEnabled(scope: Scope): boolean {
  return scope.kind === 'root' || scope.enabled;
}
/** Stable projection only: never mutates native order or creates folders. */
export function projectTree(nodes: readonly TreeNode[], scope: Scope, enabled: boolean): Projection {
  if (!enabled || !isScopeEnabled(scope)) return { mode: 'normal', nodes };
  return {
    mode: 'inl',
    sections: ROLES.map(role => ({
      role,
      nodes: nodes.filter(node => (node.role ?? 'library') === role),
      collapsed: role !== 'now',
    })),
  };
}
/** Used only on a confirmed creation event, never on tree refresh. */
export function roleForNewDocument(scope: Scope, section?: Role): Role | undefined {
  return isScopeEnabled(scope) ? section ?? 'inbox' : undefined;
}
