/**
 * External Agent Skills discovery.
 *
 * Scans a fixed list of machine-level skill roots (e.g. `~/.agents/skills`) for
 * `<root>/<entry>/SKILL.md` directories and returns the validated skills plus
 * any non-fatal issues.
 *
 * Constraints (see the slice spec):
 * - Roots are scanned SEQUENTIALLY. The first root wins on id collisions, so
 *   concurrency here would break precedence.
 * - Depth is exactly one level. Nothing is recursed into and nothing is executed.
 * - Only SKILL.md is read. Its size is checked with `stat` before reading.
 * - `stat` (not `Dirent.isDirectory()`) is used so symlinked skill dirs are followed.
 * - `discoverExternalSkills` never rejects. Every per-entry failure becomes an issue.
 * - Output strings are raw. Sanitization happens at print time, not here.
 */
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';

import { parseSkillFile } from './parse-skill-file.js';
import type {
  ExternalSkill,
  ExternalSkillDiscovery,
  ExternalSkillIssue,
  ExternalSkillIssueReason,
  ExternalSkillRoot,
} from './types.js';

/** Maximum number of directory entries considered per root. Extra entries are dropped with a `root-truncated` issue. */
const MAX_ENTRIES_PER_ROOT = 200;

/** SKILL.md files larger than this are reported as `too-large` and never read. */
const MAX_SKILL_FILE_BYTES = 64 * 1024;

const SKILL_FILE_NAME = 'SKILL.md';

/** Root-relative skill directories, in precedence order (first wins). */
const EXTERNAL_SKILL_ROOT_SUFFIXES = [
  '.agents/skills',
  '.config/agents/skills',
  '.claude/skills',
  '.codex/skills',
  '.config/opencode/skills',
  '.config/opencode/skill',
  '.cursor/skills',
  '.gemini/skills',
  '.copilot/skills',
  '.pi/agent/skills',
] as const;

/** Error codes that mean "this path simply is not there" rather than "something went wrong". */
const MISSING_PATH_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

/** Mutable state threaded through one discovery run. */
interface DiscoveryState {
  seenRealpaths: Set<string>;
  byId: Map<string, ExternalSkill>;
  issues: ExternalSkillIssue[];
}

function errorCode(err: unknown): string {
  return (err as NodeJS.ErrnoException | undefined)?.code ?? 'unknown';
}

/** Build an issue, omitting `detail` entirely when absent (exactOptionalPropertyTypes). */
function issue(
  path: string,
  reason: ExternalSkillIssueReason,
  detail?: string
): ExternalSkillIssue {
  return detail === undefined ? { path, reason } : { path, reason, detail };
}

/** Machine-level external skill roots under `homeDir`, in precedence order. */
function getExternalSkillRoots(homeDir: string): ExternalSkillRoot[] {
  return EXTERNAL_SKILL_ROOT_SUFFIXES.map((suffix) => ({
    path: join(homeDir, ...suffix.split('/')),
  }));
}

/**
 * Discover external skills across roots.
 *
 * Precedence and de-duplication:
 * - A skill directory whose realpath was already seen is skipped silently.
 * - The same skill id at a different realpath is recorded as `shadowed`; the first root wins.
 * - Entries within a root are processed in sorted name order so output is deterministic.
 *
 * Builtin collisions are NOT handled here. They are resolved in `mergeSkillCatalog`.
 */
// CRAP-only: pre-commit audit runs without --coverage (CRAP=cc²+cc); covered by discover-external-skills.test.ts. Remove when the gate receives coverage.
// fallow-ignore-next-line complexity
export async function discoverExternalSkills(options?: {
  homeDir?: string;
  roots?: ExternalSkillRoot[];
  maxEntriesPerRoot?: number;
}): Promise<ExternalSkillDiscovery> {
  const roots = options?.roots ?? getExternalSkillRoots(options?.homeDir ?? os.homedir());
  const cap = options?.maxEntriesPerRoot ?? MAX_ENTRIES_PER_ROOT;
  const state: DiscoveryState = { seenRealpaths: new Set(), byId: new Map(), issues: [] };

  // Sequential on purpose: precedence depends on root order.
  for (const root of roots) {
    await scanRoot(root.path, cap, state);
  }

  const skills = [...state.byId.values()].sort((a, b) => a.skillId.localeCompare(b.skillId));
  return { skills, issues: state.issues };
}

/** Scan one root's direct children, capped at `cap` entries. */
// CRAP-only: pre-commit audit runs without --coverage (CRAP=cc²+cc); covered by discover-external-skills.test.ts. Remove when the gate receives coverage.
// fallow-ignore-next-line complexity
async function scanRoot(rootPath: string, cap: number, state: DiscoveryState): Promise<void> {
  const names = await listRoot(rootPath, state.issues);
  if (names === undefined) return;

  const candidates = names.filter((name) => !name.startsWith('.')).sort();
  if (candidates.length > cap) {
    state.issues.push(issue(rootPath, 'root-truncated', String(candidates.length)));
  }

  for (const entry of candidates.slice(0, cap)) {
    const sourcePath = join(rootPath, entry);
    try {
      await scanEntry(entry, sourcePath, state);
    } catch (err) {
      // Last-resort guard: discovery must never reject.
      state.issues.push(issue(sourcePath, 'unreadable', errorCode(err)));
    }
  }
}

/** List a root's entries. Returns undefined when the root is missing or unreadable. */
async function listRoot(
  rootPath: string,
  issues: ExternalSkillIssue[]
): Promise<string[] | undefined> {
  try {
    return await readdir(rootPath);
  } catch (err) {
    const code = errorCode(err);
    if (!MISSING_PATH_CODES.has(code)) issues.push(issue(rootPath, 'root-unreadable', code));
    return undefined;
  }
}

/** Validate one `<root>/<entry>` candidate and record the result into `state`. */
// CRAP-only: pre-commit audit runs without --coverage (CRAP=cc²+cc); covered by discover-external-skills.test.ts. Remove when the gate receives coverage.
// fallow-ignore-next-line complexity
async function scanEntry(entry: string, sourcePath: string, state: DiscoveryState): Promise<void> {
  if (!(await isSkillCandidate(sourcePath, state.issues))) return;

  // Realpath de-dup happens before reading; only an accepted or shadowed entry claims the realpath (see recordSkill), so a rejected alias never hides the real directory.
  let realDir: string;
  try {
    realDir = await realpath(sourcePath);
  } catch (err) {
    state.issues.push(issue(sourcePath, 'unreadable', errorCode(err)));
    return;
  }
  if (state.seenRealpaths.has(realDir)) return;

  const content = await readSkillFile(sourcePath, state.issues);
  if (content === undefined) return;

  const parsed = parseSkillFile(content);
  if (!parsed.ok) {
    state.issues.push(issue(sourcePath, parsed.reason, parsed.detail));
    return;
  }

  recordSkill(entry, sourcePath, realDir, parsed, state);
}

/**
 * True when `sourcePath` is a directory containing a regular SKILL.md within the size limit.
 * A missing SKILL.md is silent (e.g. `synced/` layouts); a dangling SKILL.md symlink is reported as unreadable.
 */
// CRAP-only: pre-commit audit runs without --coverage (CRAP=cc²+cc); covered by discover-external-skills.test.ts. Remove when the gate receives coverage.
// fallow-ignore-next-line complexity
async function isSkillCandidate(
  sourcePath: string,
  issues: ExternalSkillIssue[]
): Promise<boolean> {
  // stat follows symlinks, so dangling links and ELOOP surface here.
  try {
    if (!(await stat(sourcePath)).isDirectory()) return false;
  } catch (err) {
    issues.push(issue(sourcePath, 'unreadable', errorCode(err)));
    return false;
  }

  const skillPath = join(sourcePath, SKILL_FILE_NAME);
  try {
    const skillStat = await stat(skillPath);
    if (!skillStat.isFile()) return false;
    if (skillStat.size > MAX_SKILL_FILE_BYTES) {
      issues.push(issue(sourcePath, 'too-large', String(skillStat.size)));
      return false;
    }
    return true;
  } catch (err) {
    const code = errorCode(err);
    if (code !== 'ENOENT' || (await isSymlink(skillPath))) {
      issues.push(issue(sourcePath, 'unreadable', code));
    }
    return false;
  }
}

/** True when `path` itself is a symlink (its target may be missing). */
async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

async function readSkillFile(
  sourcePath: string,
  issues: ExternalSkillIssue[]
): Promise<string | undefined> {
  try {
    return await readFile(join(sourcePath, SKILL_FILE_NAME), 'utf8');
  } catch (err) {
    issues.push(issue(sourcePath, 'unreadable', errorCode(err)));
    return undefined;
  }
}

/** Apply identity and precedence rules to a parsed skill, then record it or report why not. */
function recordSkill(
  entry: string,
  sourcePath: string,
  realDir: string,
  parsed: { name: string; description: string; body: string },
  state: DiscoveryState
): void {
  // Identity: frontmatter name must equal the directory entry name.
  if (parsed.name !== entry) {
    state.issues.push(
      issue(sourcePath, 'name-mismatch', `name "${parsed.name}" ≠ directory "${entry}"`)
    );
    return;
  }

  // Accepted or shadowed entries claim the realpath; rejected entries never do.
  state.seenRealpaths.add(realDir);

  // Precedence: first root wins on id collision.
  const winner = state.byId.get(parsed.name);
  if (winner) {
    state.issues.push(issue(sourcePath, 'shadowed', winner.sourcePath));
    return;
  }

  state.byId.set(parsed.name, {
    skillId: parsed.name,
    name: parsed.name,
    description: parsed.description,
    skillDir: realDir,
    sourcePath,
    body: parsed.body,
  });
}
