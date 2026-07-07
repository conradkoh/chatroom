/**
 * Returns true when a markdown link href should open in the workspace explorer
 * rather than navigating the browser.
 */
export function isWorkspaceFileLink(href: string | undefined): href is string {
  if (!href || href.startsWith('#')) return false;
  if (/^(https?:|mailto:|data:|javascript:)/i.test(href)) return false;
  return true;
}

/** Normalize a workspace file href to a repo-relative path for the explorer. */
export function normalizeWorkspaceFilePath(href: string): string {
  const withoutProtocol = href.startsWith('file://') ? href.slice('file://'.length) : href;
  const trimmed = withoutProtocol.replace(/^\/+/, '');
  return trimmed.startsWith('./') ? trimmed.slice(2) : trimmed;
}
