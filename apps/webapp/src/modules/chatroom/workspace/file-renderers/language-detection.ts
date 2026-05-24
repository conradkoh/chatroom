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

const EAGER_LANGS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'json',
  'md',
]);

export type DetectedLanguage = { lang: string; isEager: boolean } | null;

export function detectLanguage(path: string): DetectedLanguage {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) return null;
  const ext = path.slice(lastDot).toLowerCase();
  const lang = EXTENSION_TO_LANG[ext];
  if (!lang) return null;
  return { lang, isEager: EAGER_LANGS.has(lang) };
}
