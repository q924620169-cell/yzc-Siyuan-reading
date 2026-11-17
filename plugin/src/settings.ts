export const STYLES = ['notion', 'anthropic'] as const;
export type Style = typeof STYLES[number];
export const TYPOGRAPHIES = ['notion', 'anthropic'] as const;
export type Typography = typeof TYPOGRAPHIES[number];
export interface Settings {
  schemaVersion: 2;
  style: Style;
  typography: Typography;
  inlEnabled: boolean;
  coloredHeadings: boolean;
  coloredTree: boolean;
  coloredTabs: boolean;
  notebookCounts: boolean;
  inlFocusNavigation: boolean;
  inlSingleSection: boolean;
}
export function normalizeSettings(raw: unknown): Settings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    schemaVersion: 2,
    style: STYLES.includes(value.style as Style) ? value.style as Style : 'notion',
    typography: TYPOGRAPHIES.includes(value.typography as Typography) ? value.typography as Typography : 'notion',
    inlEnabled: value.inlEnabled === true,
    coloredHeadings: false,
    coloredTree: false,
    coloredTabs: false,
    notebookCounts: true,
    inlFocusNavigation: value.inlFocusNavigation === true,
    inlSingleSection: value.inlSingleSection === true,
  };
}

/** Selecting a visual preset starts from its matching typography again. */
export function selectStyle(style: Style): Partial<Settings> {
  return { style, typography: style };
}
