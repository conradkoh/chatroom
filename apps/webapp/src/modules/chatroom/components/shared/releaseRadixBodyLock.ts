export function releaseRadixBodyLock(): void {
  if (typeof document === 'undefined') return;
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  document.body.removeAttribute('data-scroll-locked');
}
