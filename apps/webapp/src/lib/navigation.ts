/**
 * Open an external URL in the system browser.
 *
 * Uses a programmatic anchor click instead of window.open() to ensure
 * PWAs open external links in the system browser rather than within
 * the PWA window scope.
 */
export function openExternalUrl(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.click();
}
