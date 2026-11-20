/**
 * Bounded async repository scanner for the machine's local repository ledger.
 *
 * Product rule: the daemon must never block its loop or scan aggressively. The
 * scan is on demand, asynchronous, breadth-first, and bounded by depth,
 * directory count, repository count and wall-clock budget. Event-loop yields
 * keep the daemon responsive while a large tree is walked.
 *
 * Constraints this module guarantees:
 * - A repository is a directory containing a `.git` **directory**. A `.git`
 *   **file** (worktree/submodule) is not a repository.
 * - Descent never continues below a repository, so nested repositories are not
 *   listed.
 * - Symlinks are never followed. `readdir` Dirents are used directly and only
 *   entries where `isDirectory()` is true are considered, so symlinked
 *   directories are skipped and symlink loops terminate.
 * - Dot-directories and known heavy/cache directories are skipped.
 * - Filesystem errors never escape: unreadable directories are skipped and a
 *   bad root is reported as `missing` or `unreadable`.
 * - Remote URLs are redacted so no password or token can reach a ledger.
 */

import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, parse, resolve } from 'node:path';

import { SHALLOW_SYNC_DIR_NAMES } from '../services/workspace/workspace-visibility-policy.js';

export interface LedgerRepository {
  path: string;
  name: string;
  root: string;
  branch: string | null;
  remoteUrl: string | null;
}

export type RootScanStatus = 'ok' | 'missing' | 'unreadable';

export interface ScanOptions {
  roots: string[];
  maxDepth?: number;
  maxDirectories?: number;
  maxRepositories?: number;
  timeBudgetMs?: number;
  now?: () => number;
  yieldEvery?: number;
}

export interface ScanResult {
  repositories: LedgerRepository[];
  roots: { path: string; status: RootScanStatus; repositoryCount: number }[];
  truncated: boolean;
}

// fallow-ignore-next-line unused-export
export const SCAN_DEFAULTS = {
  maxDepth: 6,
  maxDirectories: 20_000,
  maxRepositories: 1000, // mirrors backend LEDGER_MAX_ENTRIES; CLI does not import backend
  timeBudgetMs: 60_000,
  yieldEvery: 200,
} as const;

// fallow-ignore-next-line unused-export
export const SKIP_DIR_NAMES: ReadonlySet<string> = new Set([
  ...SHALLOW_SYNC_DIR_NAMES,
  'Library',
  'target',
  'vendor',
  'venv',
  'Pods',
  'bower_components',
  '.Trash',
]);

const HEAD_BRANCH_PATTERN = /^ref: refs\/heads\/(.+)$/;
const REMOTE_SECTION_PATTERN = /^\[\s*remote\s+"([^"]+)"\s*\]$/i;
const ANY_SECTION_PATTERN = /^\[.*\]$/;
const URL_LINE_PATTERN = /^url\s*=\s*(.+)$/i;

/** `path.resolve`, then drop a trailing separator unless the path is a filesystem root. */
function normalizeDirectory(input: string): string {
  const resolved = resolve(input);
  if (parse(resolved).root === resolved) return resolved;
  return resolved.replace(/[\\/]+$/, '');
}

function dedupeRoots(roots: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const root of roots) {
    const normalized = normalizeDirectory(root);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null | undefined)?.code;
}

/** A `.git` directory marks a repository; a `.git` file (worktree) does not. */
async function isGitDirectory(directoryPath: string): Promise<boolean> {
  try {
    // lstat, not stat: a symlinked `.git` is not a directory marker.
    return (await lstat(join(directoryPath, '.git'))).isDirectory();
  } catch {
    return false;
  }
}

async function readGitFile(repositoryPath: string, fileName: string): Promise<string | null> {
  try {
    return await readFile(join(repositoryPath, '.git', fileName), 'utf8');
  } catch {
    return null;
  }
}

/** `ref: refs/heads/feat/x` → `feat/x`; detached HEADs and anything else → null. */
function parseHeadBranch(head: string | null): string | null {
  if (head === null) return null;
  const match = HEAD_BRANCH_PATTERN.exec(head.trim());
  return match?.[1]?.trim() || null;
}

/**
 * Reads the `url` of the `origin` remote, else the first remote with a url.
 * Subsection names are matched case-insensitively, like git itself.
 */
// fallow-ignore-next-line complexity
function parseRemoteUrl(config: string | null): string | null {
  if (config === null) return null;

  const urls = new Map<string, string>();
  let currentRemote: string | null = null;

  for (const rawLine of config.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;

    const remoteMatch = REMOTE_SECTION_PATTERN.exec(line);
    if (remoteMatch?.[1]) {
      currentRemote = remoteMatch[1];
      continue;
    }
    if (ANY_SECTION_PATTERN.test(line)) {
      currentRemote = null;
      continue;
    }
    if (currentRemote === null) continue;

    const urlMatch = URL_LINE_PATTERN.exec(line);
    if (!urlMatch?.[1]) continue;
    if (!urls.has(currentRemote)) urls.set(currentRemote, urlMatch[1].trim());
  }

  const origin = urls.get('origin');
  if (origin !== undefined) return origin;

  const first = urls.values().next();
  return first.done ? null : first.value;
}

/**
 * Strips userinfo from URL-style remotes (`scheme://user:tok@host/...` →
 * `scheme://host/...`). scp-style remotes (`git@host:org/repo`) have no `://`
 * and are returned untouched. A URL with a password or token is never returned.
 */
// fallow-ignore-next-line complexity
function redactRemoteUrl(url: string): string {
  const schemeSeparator = url.indexOf('://');
  if (schemeSeparator === -1) return url;

  const scheme = url.slice(0, schemeSeparator);
  const remainder = url.slice(schemeSeparator + 3);
  const authorityEnd = remainder.indexOf('/');
  const authority = authorityEnd === -1 ? remainder : remainder.slice(0, authorityEnd);
  const atIndex = authority.lastIndexOf('@');
  if (atIndex === -1) return url;

  const suffix = authorityEnd === -1 ? '' : remainder.slice(authorityEnd);
  return `${scheme}://${authority.slice(atIndex + 1)}${suffix}`;
}

async function readRepository(repositoryPath: string, root: string): Promise<LedgerRepository> {
  const head = await readGitFile(repositoryPath, 'HEAD');
  const config = await readGitFile(repositoryPath, 'config');
  const remoteUrl = parseRemoteUrl(config);

  return {
    path: repositoryPath,
    name: basename(repositoryPath),
    root,
    branch: parseHeadBranch(head),
    remoteUrl: remoteUrl === null ? null : redactRemoteUrl(remoteUrl),
  };
}

/**
 * Scans `roots` breadth-first with one shared budget across all roots.
 *
 * `roots[]` in the result contains one entry per distinct normalized root in
 * input order. When the shared budget stops the scan, roots that were not
 * visited are reported as `ok` with zero repositories; `truncated` signals that
 * the ledger is incomplete.
 */
// fallow-ignore-next-line complexity
export async function scanRepositories(options: ScanOptions): Promise<ScanResult> {
  const maxDepth = options.maxDepth ?? SCAN_DEFAULTS.maxDepth;
  const maxDirectories = options.maxDirectories ?? SCAN_DEFAULTS.maxDirectories;
  const maxRepositories = options.maxRepositories ?? SCAN_DEFAULTS.maxRepositories;
  const timeBudgetMs = options.timeBudgetMs ?? SCAN_DEFAULTS.timeBudgetMs;
  const yieldEvery = options.yieldEvery ?? SCAN_DEFAULTS.yieldEvery;
  const now = options.now ?? Date.now;

  const roots = dedupeRoots(options.roots);
  const repositories: LedgerRepository[] = [];
  const rootSummaries: ScanResult['roots'] = [];
  const startedAt = now();
  let directoriesScanned = 0;
  let truncated = false;
  let stopped = false;

  for (const root of roots) {
    if (stopped) {
      rootSummaries.push({ path: root, status: 'ok', repositoryCount: 0 });
      continue;
    }

    let rootStatus: RootScanStatus = 'ok';
    let repositoryCount = 0;

    let rootStat;
    try {
      rootStat = await stat(root);
    } catch (error) {
      const code = errorCode(error);
      rootStatus = code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable';
      rootSummaries.push({ path: root, status: rootStatus, repositoryCount: 0 });
      continue;
    }

    if (!rootStat.isDirectory()) {
      rootSummaries.push({ path: root, status: 'missing', repositoryCount: 0 });
      continue;
    }

    if (await isGitDirectory(root)) {
      if (repositories.length >= maxRepositories) {
        truncated = true;
        stopped = true;
        rootSummaries.push({ path: root, status: 'ok', repositoryCount: 0 });
        continue;
      }
      repositories.push(await readRepository(root, root));
      rootSummaries.push({ path: root, status: 'ok', repositoryCount: 1 });
      continue;
    }

    // Sequential breadth-first walk: no fan-out over directories.
    const queue: { directory: string; depth: number }[] = [{ directory: root, depth: 0 }];

    while (queue.length > 0) {
      if (now() - startedAt >= timeBudgetMs) {
        truncated = true;
        stopped = true;
        break;
      }
      if (directoriesScanned >= maxDirectories) {
        truncated = true;
        stopped = true;
        break;
      }

      const current = queue.shift();
      if (current === undefined) break;

      directoriesScanned += 1;
      if (yieldEvery > 0 && directoriesScanned % yieldEvery === 0) {
        await new Promise<void>((resume) => setImmediate(resume));
      }

      let entries;
      try {
        entries = await readdir(current.directory, { withFileTypes: true });
      } catch {
        if (current.directory === root) rootStatus = 'unreadable';
        continue;
      }

      // Stable order keeps caps deterministic and ledgers reproducible.
      entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

      for (const entry of entries) {
        // Dirent type never follows symlinks, so symlinked directories are skipped.
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || SKIP_DIR_NAMES.has(entry.name)) continue;

        const childPath = join(current.directory, entry.name);
        const childDepth = current.depth + 1;

        // A child beyond the depth cap is not inspected, so a repository there is hidden.
        if (childDepth > maxDepth) {
          truncated = true;
          continue;
        }

        if (await isGitDirectory(childPath)) {
          if (repositories.length >= maxRepositories) {
            truncated = true;
            stopped = true;
            break;
          }
          repositories.push(await readRepository(childPath, root));
          repositoryCount += 1;
        } else {
          queue.push({ directory: childPath, depth: childDepth });
        }
      }

      if (stopped) break;
    }

    rootSummaries.push({ path: root, status: rootStatus, repositoryCount });
  }

  return { repositories, roots: rootSummaries, truncated };
}
