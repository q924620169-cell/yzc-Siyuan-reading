export const TREE = '.file-tree:not(.sy__outline)';
export const ITEMS = '.file-tree__items';
export const ROOT = 'li[data-type="navigation-root"]';
export const ROW = 'li[data-type="navigation-file"]';

const NOTEBOOK_PREFIX = 'notebook:';

export function flatList(items: Element): HTMLElement | null {
  return items.querySelector<HTMLElement>(':scope > ul[role="tree"]');
}

export function occurrence(row: HTMLElement): string | undefined {
  const key = row.dataset.treeKey;
  return key?.startsWith(NOTEBOOK_PREFIX) ? key : undefined;
}

export function notebookId(row: HTMLElement): string | undefined {
  return occurrence(row)?.split('/', 1)[0].slice(NOTEBOOK_PREFIX.length)
    || row.closest<HTMLElement>('ul[data-url]')?.dataset.url;
}

export function nodeId(row: HTMLElement): string | undefined {
  const notebook = notebookId(row);
  return row.matches(ROOT) ? (notebook ? NOTEBOOK_PREFIX + notebook : undefined) : row.dataset.nodeId || undefined;
}

export function scopeKey(row: HTMLElement): string | undefined {
  const notebook = notebookId(row);
  return notebook ? `${notebook}/${row.matches(ROOT) ? '' : row.dataset.nodeId}` : undefined;
}

export function parentOccurrence(row: HTMLElement): string | undefined {
  const key = occurrence(row);
  const slash = key?.lastIndexOf('/') ?? -1;
  return slash < 0 ? undefined : key!.slice(0, slash);
}

export function canExpand(row: HTMLElement): boolean {
  return row.matches(ROOT) || Number(row.dataset.count) > 0
    || row.hasAttribute('aria-expanded') || row.nextElementSibling?.tagName === 'UL';
}

export function isExpanded(row: HTMLElement): boolean {
  return row.getAttribute('aria-expanded') === 'true' || !!row.querySelector('.b3-list-item__arrow--open');
}

export function flatRows(list: HTMLElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>(`${ROOT}[data-tree-key], ${ROW}[data-tree-key]`)]
    .filter(row => occurrence(row) && !row.closest('[data-tree-animation][aria-hidden="true"]'));
}
