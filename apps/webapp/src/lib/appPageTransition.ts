import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime';

export type AppPageTransitionDirection = 'forward' | 'back';

let transitionInProgress = false;

export function resetAppPageTransitionForTests(): void {
  transitionInProgress = false;
  if (typeof document !== 'undefined') {
    delete document.documentElement.dataset.appPageTransition;
    delete document.documentElement.dataset.appPageTransitionActive;
  }
}

export function navigateWithAppPageTransition(
  router: AppRouterInstance,
  href: string,
  direction: AppPageTransitionDirection
): void {
  if (typeof document === 'undefined') {
    router.push(href);
    return;
  }
  if (transitionInProgress) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    router.push(href);
    return;
  }

  const startVT = document.startViewTransition?.bind(document);
  if (!startVT) {
    router.push(href);
    return;
  }

  transitionInProgress = true;
  document.documentElement.dataset.appPageTransition = direction;
  document.documentElement.dataset.appPageTransitionActive = 'true';

  startVT(() => {
    router.push(href);
  }).finished.finally(() => {
    transitionInProgress = false;
    delete document.documentElement.dataset.appPageTransition;
    delete document.documentElement.dataset.appPageTransitionActive;
  });
}
