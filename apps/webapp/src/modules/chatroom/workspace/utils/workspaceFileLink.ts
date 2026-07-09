/**
 * File extensions we auto-linkify. Longest names first so regex alternation
 * matches `tsx` before `ts`, `jsx` before `js`, etc.
 */
const WORKSPACE_LINKABLE_EXTENSION_NAMES = [
  'tsx',
  'jsx',
  'mjs',
  'cjs',
  'scss',
  'mdx',
  'yaml',
  'html',
  'json',
  'toml',
  'wasm',
  'svelte',
  'swift',
  'java',
  'ts',
  'js',
  'md',
  'css',
  'yml',
  'sql',
  'xml',
  'svg',
  'txt',
  'vue',
  'php',
  'rb',
  'kt',
  'go',
  'rs',
  'py',
  'sh',
] as const;

const WORKSPACE_EXTENSION_ALTERNATION = WORKSPACE_LINKABLE_EXTENSION_NAMES.join('|');

const WORKSPACE_LINKABLE_EXTENSIONS = new RegExp(`\\.(${WORKSPACE_EXTENSION_ALTERNATION})$`, 'i');

/** Repo-relative path segment: letters, digits, common filename chars. */
const WORKSPACE_PATH_BODY = new RegExp(
  `(?:\\.\\./|\\.\\/)?(?:[A-Za-z0-9_@+.-]+\\/)+[A-Za-z0-9_@+.-]+\\.(${WORKSPACE_EXTENSION_ALTERNATION})`,
  'gi'
);

export function looksLikeWorkspacePath(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (/^(https?:|mailto:|data:|javascript:|#)/i.test(trimmed)) return false;
  if (!trimmed.includes('/')) return false;
  return WORKSPACE_LINKABLE_EXTENSIONS.test(trimmed);
}

/** Split prose text into mdast phrasing nodes (text + link). */
export function splitTextOnWorkspacePaths(
  text: string
): (
  | { type: 'text'; value: string }
  | { type: 'link'; url: string; children: [{ type: 'text'; value: string }] }
)[] {
  const nodes: (
    | { type: 'text'; value: string }
    | { type: 'link'; url: string; children: [{ type: 'text'; value: string }] }
  )[] = [];
  let lastIndex = 0;
  const re = new RegExp(WORKSPACE_PATH_BODY.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const path = match[0];
    if (!looksLikeWorkspacePath(path)) continue;
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    nodes.push({ type: 'link', url: path, children: [{ type: 'text', value: path }] });
    lastIndex = match.index + path.length;
  }
  if (lastIndex < text.length) {
    nodes.push({ type: 'text', value: text.slice(lastIndex) });
  }
  if (nodes.length === 0) {
    nodes.push({ type: 'text', value: text });
  }
  return nodes;
}

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
