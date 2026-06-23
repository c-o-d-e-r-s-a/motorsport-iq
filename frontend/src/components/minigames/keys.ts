/**
 * The arcade stays mounted even while a live question is on screen, so its games attach
 * window-level key listeners. This guard stops those listeners from hijacking keystrokes
 * meant for interactive controls outside the arcade (e.g. answering Yes/No with the keyboard),
 * while still letting games respond when nothing external is focused.
 */
export const ARCADE_ROOT_ATTR = 'data-arcade-root';

export function isExternalControlFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return false;
  const isInteractive = active.matches('button, a, input, select, textarea, [role="button"], [contenteditable="true"]');
  if (!isInteractive) return false;
  return !active.closest(`[${ARCADE_ROOT_ATTR}]`);
}
