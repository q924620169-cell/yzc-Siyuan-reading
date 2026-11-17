import postcss from 'postcss';

// SiYuan inserts this static stylesheet before running the plugin. Its own DOM
// presence scopes first-paint visuals without waiting for an async JS attribute.
export const THEME_GATE = ':where(html:has(#pluginsStyleyzc-INL))';
export const PLUGIN_GATE = THEME_GATE;

/** Prefix parsed selectors, preserving specificity and all font/keyframe syntax. */
export function scopeCss(css, gate = THEME_GATE) {
  const root = postcss.parse(css);
  root.walkRules(rule => {
    for (let parent = rule.parent; parent; parent = parent.parent)
      if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return;
    rule.selectors = rule.selectors.map(selector => /^:root\b/.test(selector)
      ? selector.replace(/^:root/, `:root${gate}`) : `${gate} ${selector}`);
  });
  return root.toString();
}
