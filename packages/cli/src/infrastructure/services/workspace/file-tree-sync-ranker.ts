// fallow-ignore-file unused-export complexity
export const SOURCE_DIR_NAMES = new Set([
  'src',
  'lib',
  'app',
  'apps',
  'packages',
  'services',
  'server',
  'client',
  'backend',
  'frontend',
  'api',
  'cmd',
  'internal',
  'pkg',
  'components',
  'modules',
  'pages',
  'routes',
  'hooks',
  'domain',
  'infrastructure',
  'entry',
]);
export const BUILD_DIR_NAMES = new Set([
  'dist',
  'build',
  'out',
  'output',
  'coverage',
  '.next',
  '.turbo',
  '.nx',
  '_generated',
  'generated',
  '__pycache__',
]);
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.rb',
  '.php',
  '.cs',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.vue',
  '.svelte',
  '.css',
  '.scss',
  '.less',
]);
const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);
const CONFIG_EXTENSIONS = new Set(['.yml', '.yaml', '.toml', '.jsonc', '.ini', '.cfg']);
const CONFIG_BASENAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'bun.lock',
  'tsconfig.json',
  'jsconfig.json',
  'turbo.json',
  'nx.json',
  'cargo.toml',
  'go.mod',
  'go.sum',
  'pyproject.toml',
  'requirements.txt',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'makefile',
  '.gitignore',
  '.cursorignore',
  '.editorconfig',
  '.prettierrc',
  '.nvmrc',
  'eslint.config.mjs',
  'eslint.config.js',
  'biome.json',
  '.fallowrc.jsonc',
]);
const BUILD_OUTPUT_EXTENSIONS = new Set([
  '.map',
  '.min.js',
  '.min.css',
  '.pyc',
  '.pyo',
  '.o',
  '.obj',
  '.wasm',
  '.class',
  '.jar',
  '.exe',
  '.dll',
  '.so',
]);
const DATA_EXTENSIONS = new Set([
  '.json',
  '.csv',
  '.tsv',
  '.ndjson',
  '.parquet',
  '.avro',
  '.bin',
  '.dat',
  '.pb',
  '.sqlite',
  '.db',
  '.log',
  '.gz',
  '.zip',
  '.tar',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.mp4',
  '.woff',
  '.woff2',
]);
export const SCORE_SOURCE_IN_SOURCE_DIR = 1000;
export const SCORE_MARKDOWN = 800;
export const SCORE_CONFIG = 700;
export const SCORE_SOURCE_ELSEWHERE = 200;
export const PENALTY_BUILD_DIR = 5000;
export const PENALTY_BUILD_EXT = 2000;
export function fileExtension(p: string) {
  const b = (p.split('/').pop() ?? p).toLowerCase();
  if (b.endsWith('.min.js')) return '.min.js';
  if (b.endsWith('.min.css')) return '.min.css';
  const i = b.lastIndexOf('.');
  return i <= 0 ? '' : b.slice(i);
}
export function pathSegments(p: string) {
  return p.split('/').filter(Boolean);
}
export function parentDir(p: string) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}
export function isSourceDirPath(p: string) {
  return pathSegments(p)
    .slice(0, -1)
    .some((s) => SOURCE_DIR_NAMES.has(s));
}
export function isBuildDirPath(p: string) {
  return pathSegments(p).some((s) => BUILD_DIR_NAMES.has(s));
}
export function isMarkdownFile(p: string) {
  return MARKDOWN_EXTENSIONS.has(fileExtension(p));
}
export function isConfigFile(p: string) {
  return (
    CONFIG_BASENAMES.has((p.split('/').pop() ?? '').toLowerCase()) ||
    CONFIG_EXTENSIONS.has(fileExtension(p))
  );
}
export function isSourceFile(p: string) {
  return SOURCE_EXTENSIONS.has(fileExtension(p));
}
export function isBuildOutputFile(p: string) {
  return BUILD_OUTPUT_EXTENSIONS.has(fileExtension(p));
}
export function isDataFile(p: string) {
  return !isConfigFile(p) && DATA_EXTENSIONS.has(fileExtension(p));
}
export function countDataFilesByParent(ps: readonly string[]) {
  const m = new Map<string, number>();
  for (const p of ps)
    if (isDataFile(p)) {
      const d = parentDir(p);
      m.set(d, (m.get(d) ?? 0) + 1);
    }
  return m;
}
export function scoreFile(p: string, m: ReadonlyMap<string, number>) {
  let s = 0;
  if (isSourceFile(p))
    s += isSourceDirPath(p) ? SCORE_SOURCE_IN_SOURCE_DIR : SCORE_SOURCE_ELSEWHERE;
  if (isMarkdownFile(p)) s += SCORE_MARKDOWN;
  if (isConfigFile(p)) s += SCORE_CONFIG;
  if (isBuildDirPath(p)) s -= PENALTY_BUILD_DIR;
  if (isBuildOutputFile(p)) s -= PENALTY_BUILD_EXT;
  const n = m.get(parentDir(p)) ?? 0;
  return s - n * n;
}
export function compareRankedFiles(a: string, as: number, b: string, bs: number) {
  if (as !== bs) return bs - as;
  const d = pathSegments(a).length - pathSegments(b).length;
  return d || a.localeCompare(b);
}
