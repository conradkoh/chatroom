// fallow-ignore-file unused-file unused-export
/**
 * Global stack for layered overlay dismiss handlers (portaled menus, modals).
 * Escape closes only the topmost registered layer.
 */
type OverlayDismissHandler = () => void;

let overlayDismissStack: OverlayDismissHandler[] = [];

export function pushOverlayDismiss(handler: OverlayDismissHandler): void {
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
