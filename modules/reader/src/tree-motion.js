import { foldContent } from '../../../shared/motion.js';

export function toggleBranch(details, opening) {
  const children = details.querySelector(':scope > .yr-course-children');
  if (!children) return;
  details.querySelector(':scope > summary').setAttribute('aria-expanded', String(opening));
  foldContent(children, opening, {
    expose: () => { details.open = true; },
    settle: () => { details.open = opening; },
  });
}
