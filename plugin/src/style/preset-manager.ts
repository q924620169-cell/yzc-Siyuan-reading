import type { Style } from '../settings';
export function applyPreset(root: HTMLElement, style: Style): void {
  root.setAttribute('data-style', style);
}
