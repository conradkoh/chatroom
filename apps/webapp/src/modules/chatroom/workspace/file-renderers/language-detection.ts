const EXTENSION_TO_LANG: Record<string, string> = {
  '.ts': 'ts',
  '.tsx': 'tsx',
  '.js': 'js',
  '.jsx': 'jsx',
  '.mjs': 'js',
  '.cjs': 'js',
  '.json': 'json',
  '.md': 'md',
  '.mdx': 'md',
  '.markdown': 'md',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'html',
  '.htm': 'html',
  '.xml': 'xml',
  '.py': 'py',
  '.sh': 'sh',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.rs': 'rs',
  '.go': 'go',
  '.sql': 'sql',
};

const EAGER_LANGS = new Set(['ts', 'tsx', 'js', 'jsx', 'json', 'md']);

export const MAX_FILE_SIZE = 500_000;

export type DetectedLanguage = { lang: string; isEager: boolean } | null;

export function detectLanguage(path: string): DetectedLanguage {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) return null;
  const ext = path.slice(lastDot).toLowerCase();
  const lang = EXTENSION_TO_LANG[ext];
  if (!lang) return null;
  return { lang, isEager: EAGER_LANGS.has(lang) };
}

const FENCE_LANG_ALIASES: Record<string, string> = {
  ts: '.ts',
  typescript: '.ts',
  js: '.js',
  javascript: '.js',
  jsx: '.jsx',
  tsx: '.tsx',
  json: '.json',
  md: '.md',
  markdown: '.md',
  py: '.py',
  python: '.py',
  go: '.go',
  golang: '.go',
  rs: '.rs',
  rust: '.rs',
  sh: '.sh',
  bash: '.sh',
  shell: '.sh',
  zsh: '.sh',
  yaml: '.yaml',
  yml: '.yaml',
  toml: '.toml',
  sql: '.sql',
  css: '.css',
  scss: '.scss',
  html: '.html',
  xml: '.xml',
};

export function fenceLangToSyntheticPath(fenceLang: string): string | null {
  const key = fenceLang.trim().toLowerCase();
  const ext = FENCE_LANG_ALIASES[key];
  if (ext) return `snippet${ext}`;
  const tryExt = key.startsWith('.') ? key : `.${key}`;
  return EXTENSION_TO_LANG[tryExt] ? `snippet${tryExt}` : null;
}
