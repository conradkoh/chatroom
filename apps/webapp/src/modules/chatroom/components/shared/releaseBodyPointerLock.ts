// fallow-ignore-file unused-file — consumed only by components/ui/* primitives, which fallow
// excludes via .fallowrc ignorePatterns, so the import graph never reaches this utility.
export function releaseBodyPointerLock(): void {
  if (typeof document === 'undefined') return;
  document.body.style.pointerEvents = '';
  document.body.style.overflow = '';
  document.body.removeAttribute('data-scroll-locked');
}
