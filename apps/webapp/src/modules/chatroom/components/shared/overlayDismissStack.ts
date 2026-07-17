// fallow-ignore-file unused-file unused-export
/**
 * Global stack for layered overlay dismiss handlers (portaled menus, modals).
 * Escape closes only the topmost registered layer.
 */
type OverlayDismissHandler = () => void;

let overlayDismissStack: OverlayDismissHandler[] = [];
let escapeListenerAttached = false;

function handleGlobalEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || overlayDismissStack.length === 0) {
    return;
  }

  const top = overlayDismissStack[overlayDismissStack.length - 1];
  event.preventDefault();
  event.stopImmediatePropagation();
  top();
}

function ensureEscapeListener(): void {
  if (escapeListenerAttached || typeof window === 'undefined') {
    return;
  }
  escapeListenerAttached = true;
  window.addEventListener('keydown', handleGlobalEscape, true);
}

export function pushOverlayDismiss(handler: OverlayDismissHandler): void {
  ensureEscapeListener();
  overlayDismissStack.push(handler);
}

export function popOverlayDismiss(handler: OverlayDismissHandler): void {
  overlayDismissStack = overlayDismissStack.filter((entry) => entry !== handler);
}

export function isTopOverlayDismiss(handler: OverlayDismissHandler): boolean {
  const top = overlayDismissStack[overlayDismissStack.length - 1];
  return top === handler;
}

/** @internal Test helper */
export function resetOverlayDismissStackForTests(): void {
  overlayDismissStack = [];
}
