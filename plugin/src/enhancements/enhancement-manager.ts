import type { Settings } from '../settings';
export function applyEnhancements(root: HTMLElement, settings: Settings): void {
  root.setAttribute('data-colored-headings', String(settings.coloredHeadings));
  root.setAttribute('data-colored-tree', String(settings.coloredTree));
  root.setAttribute('data-colored-tabs', String(settings.coloredTabs));
}
