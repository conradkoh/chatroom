/**
 * Workspace visibility policy — determines which paths appear in explorer listings
 * and which file content can be read remotely.
 */

// fallow-ignore-next-line unused-export
export const ALWAYS_EXCLUDE_DIR_NAMES = new Set([
  'node_modules',
  '.git',
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

export function isAlwaysExcludedDirName(name: string): boolean {
  return ALWAYS_EXCLUDE_DIR_NAMES.has(name);
}

// fallow-ignore-next-line unused-export
export function isSecretPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return SECRET_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function hasExcludedDirSegment(relativePath: string): boolean {
  const segments = relativePath.split('/');
  return segments.some((segment) => isAlwaysExcludedDirName(segment));
}

export function isPathVisible(relativePath: string): boolean {
  if (!relativePath) return true;
  return !isSecretPath(relativePath) && !hasExcludedDirSegment(relativePath);
}

/** File content can be read remotely (same rules as visibility for files). */
export function isPathContentReadable(relativePath: string): boolean {
  return isPathVisible(relativePath);
}
