/**
 * Workspace visibility policy — determines which paths appear in explorer listings
 * and which file content can be read remotely.
 */

import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

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

async function isGitRepo(rootDir: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync('git rev-parse --is-inside-work-tree', {
      cwd: rootDir,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', NO_COLOR: '1' },
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/** Batch git check-ignore; returns Set of ignored paths from input. */
// fallow-ignore-next-line complexity
export async function filterGitIgnored(
  rootDir: string,
  relativePaths: string[]
): Promise<Set<string>> {
  if (relativePaths.length === 0) return new Set();

  const inRepo = await isGitRepo(rootDir);
  if (!inRepo) return new Set();

  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn('git', ['check-ignore', '--stdin', '-z'], {
        cwd: rootDir,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', NO_COLOR: '1' },
      });
      let output = '';
      child.stdout.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', () => resolve(output));
      child.stdin.write(relativePaths.join('\n'));
      child.stdin.end();
    });

    const ignored = new Set<string>();
    if (!stdout) return ignored;

    for (const entry of stdout.split('\0')) {
      const trimmed = entry.trim();
      if (trimmed) ignored.add(trimmed);
    }
    return ignored;
  } catch {
    return new Set();
  }
}
