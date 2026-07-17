/**
 * Workspace visibility policy — determines which paths appear in explorer listings
 * and which file content can be read remotely.
 */

/** Directories that never appear in explorer listings or sync. */
// fallow-ignore-next-line unused-export
export const HIDDEN_DIR_NAMES = new Set(['.git']);

/**
 * Known heavy/cache directories: show a folder stub in the explorer but skip
 * recursive sync of children (lazy loading).
 */
// fallow-ignore-next-line unused-export
export const SHALLOW_SYNC_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.turbo',
  '.cache',
  '.tmp',
  'tmp',
  '_generated', // Convex codegen and similar generated output dirs
  '.vercel',
]);

/** @deprecated Use classifyDirectorySyncMode — kept for callers that only need a boolean skip. */
// fallow-ignore-next-line unused-export
export const ALWAYS_EXCLUDE_DIR_NAMES = new Set([...HIDDEN_DIR_NAMES, ...SHALLOW_SYNC_DIR_NAMES]);

// fallow-ignore-next-line unused-export
export const SECRET_PATH_PATTERNS: RegExp[] = [
  /^\.env$/,
  /^\.env\./,
  /\.pem$/,
  /\.key$/,
  /id_rsa$/,
  /credentials\.json$/,
  /^secrets(\/|$)/,
  /^\.aws(\/|$)/,
];

export type DirectorySyncMode = 'hidden' | 'shallow' | 'full';

export type DirectorySyncContext = {
  relativePath: string;
  /** Number of entries returned by readdir for the directory's parent (sibling count signal). */
  immediateSiblingCount: number;
  /** Number of entries returned by readdir inside this directory. */
  immediateChildCount: number;
};

const SHALLOW_HEURISTIC_MIN_CHILD_COUNT = 500;

function isHiddenDirName(name: string): boolean {
  return HIDDEN_DIR_NAMES.has(name);
}

function isShallowSyncDirName(name: string): boolean {
  return SHALLOW_SYNC_DIR_NAMES.has(name);
}

/** @deprecated Prefer classifyDirectorySyncMode for directory handling during walks. */
export function isAlwaysExcludedDirName(name: string): boolean {
  return isHiddenDirName(name) || isShallowSyncDirName(name);
}

function shouldShallowSyncByHeuristics(context: DirectorySyncContext): boolean {
  if (context.immediateChildCount >= SHALLOW_HEURISTIC_MIN_CHILD_COUNT) return true;

  // Very flat workspaces with hundreds of root-level folders are often dependency trees.
  if (!context.relativePath.includes('/') && context.immediateSiblingCount >= 300) {
    return context.immediateChildCount >= 100;
  }

  return false;
}

/**
 * Decide how a directory should be synced.
 *
 * - hidden: never listed
 * - shallow: list the folder stub only (children deferred)
 * - full: recurse normally
 */
export function classifyDirectorySyncMode(
  dirName: string,
  context: DirectorySyncContext
): DirectorySyncMode {
  if (isHiddenDirName(dirName)) return 'hidden';
  if (isShallowSyncDirName(dirName)) return 'shallow';
  if (shouldShallowSyncByHeuristics(context)) return 'shallow';
  return 'full';
}

// fallow-ignore-next-line unused-export
export function isSecretPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return SECRET_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

// fallow-ignore-next-line complexity
export function hasExcludedDirSegment(relativePath: string): boolean {
  const segments = relativePath.split('/');
  const lastIndex = segments.length - 1;

  for (let index = 0; index < segments.length; index++) {
    const name = segments[index];
    if (isHiddenDirName(name)) return true;
    if (isShallowSyncDirName(name) && index < lastIndex) return true;
  }

  return false;
}

export function isPathVisible(relativePath: string): boolean {
  if (!relativePath) return true;
  return !isSecretPath(relativePath) && !hasExcludedDirSegment(relativePath);
}

/** File content can be read remotely (same rules as visibility for files). */
export function isPathContentReadable(relativePath: string): boolean {
  return isPathVisible(relativePath);
}
