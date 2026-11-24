export const motion = {
  feedback: { duration: 120, easing: 'cubic-bezier(.2,.7,.3,1)' },
  reveal: { duration: 150, easing: 'cubic-bezier(.2,.7,.3,1)' },
  fold: { duration: 170, easing: 'cubic-bezier(.2,.7,.3,1)' },
  settle: { duration: 210, easing: 'cubic-bezier(.22,1,.36,1)' },
  drawer: { duration: 210, easing: 'cubic-bezier(.2,.7,.3,1)' },
  refresh: { duration: 480, easing: 'cubic-bezier(.2,.7,.3,1)' },
};

/** Finish an in-flight effect if the system preference changes while it runs. */
export function playMotion(node, frames, timing) {
  const media = node.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (!node.animate || media?.matches) return;
  const animation = node.animate(frames, timing);
  const reduce = () => { if (media.matches) animation.finish(); };
  media?.addEventListener('change', reduce);
  const cleanup = () => media?.removeEventListener('change', reduce);
  void animation.finished.then(cleanup, cleanup);
  return animation;
}

export function spinRefresh(button) {
  const icon = button?.querySelector('svg');
  if (!icon || icon.getAnimations?.().some(a => a.playState === 'running')) return;
  playMotion(icon, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], motion.refresh);
}

const folds = new WeakMap();

/** Small in-flow disclosures start from their current rendered state when reversed. */
export function foldContent(panel, open, { expose = () => {}, settle = () => {}, maxHeight = Infinity } = {}) {
  const view = panel.ownerDocument.defaultView;
  const from = panel.hidden ? 0 : panel.getBoundingClientRect().height;
  const opacity = from ? view.getComputedStyle(panel).opacity : 0;
  folds.get(panel)?.cancel();
  folds.delete(panel);
  expose();
  panel.hidden = false;
  panel.inert = !open;
  const full = Math.min(panel.getBoundingClientRect().height, maxHeight);
  const to = open ? full : 0;
  const finish = () => { panel.hidden = !open; settle(); };
  // Large trees or relation lists settle in one layout, without animating every row.
  if (from === to || Math.max(from, to) > 420) { finish(); return; }
  const animation = playMotion(panel, [
    { height: `${from}px`, opacity }, { height: `${to}px`, opacity: open ? 1 : 0 },
  ], motion.fold);
  if (!animation) { finish(); return; }
  folds.set(panel, animation);
  void animation.finished.then(() => {
    if (folds.get(panel) !== animation) return;
    folds.delete(panel);
    finish();
  }, () => {});
}

export function revealContent(node) {
  if (node) playMotion(node, [{ opacity: .72 }, { opacity: 1 }], motion.reveal);
}

export function dismissContent(node) {
  node.inert = true;
  node.style.pointerEvents = 'none';
  const opacity = node.ownerDocument.defaultView.getComputedStyle(node).opacity;
  const animation = playMotion(node, [{ opacity }, { opacity: 0 }], motion.feedback);
  if (animation) void animation.finished.then(() => node.remove(), () => node.remove());
  else node.remove();
}
