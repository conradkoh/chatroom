/**
 * Custom-agent source loader.
 *
 * Turns one source root into the deterministic set of valid agent definitions
 * plus the issues that explain everything it skipped.
 *
 * Roots:
 * - workspace: `<workspaceRoot>/.chatroom/agents`
 * - machine: `<homeDir>/.chatroom/agents` (home defaults to `os.homedir()`)
 *
 * Rules come from `@workspace/shared/domain/custom-agent`: this module only
 * decides which files to read and how to turn their bytes into a payload. The
 * backend re-validates and recomputes every hash anyway.
 *
 * Safety and determinism:
 * - The root is resolved once with `realpath`; for workspace scope it must stay
 *   inside the resolved workspace. Directory entries and files are `lstat`ed
 *   and never followed.
 * - Root entries are sorted before scanning, agents are sorted by name, and
 *   issues are sorted by `(path, reason, detail)`, so two runs over the same
 *   tree produce byte-identical output and readdir order never leaks.
 * - Every issue `path` is relative to the source root; no issue `detail` carries
 *   an absolute path, a home directory, or an OS error message.
 * - The loader never throws: every filesystem failure becomes an issue.
 */

import { lstat, readdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  CUSTOM_AGENT_LIMITS,
  computeCustomAgentContentHash,
  sanitizeCustomAgentSummary,
  validateCustomAgentPayload,
  type CustomAgentDefinitionPayload,
  type CustomAgentIssue,
  type CustomAgentIssueReason,
  type CustomAgentScope,
} from '@workspace/shared/domain/custom-agent';
import type { Ignore } from 'ignore';

import { parseAgentFile, type FrontmatterFlaggedKey } from './parse-agent-frontmatter.js';
import { errorCode, safeReadTextFile, type SafeReadFailure } from './safe-read.js';
import { loadGitIgnoreMatcher } from '../workspace/workspace-ignore.js';
import { isPathInsideRoot } from '../workspace/workspace-path-security.js';

/** One loaded definition. `disabled` is machine-local state, stamped by the daemon. */
export type LoadedCustomAgent = Omit<CustomAgentDefinitionPayload, 'disabled'>;

export interface LoadCustomAgentSourceInput {
  scope: CustomAgentScope;
  /** Workspace root; required for `workspace` scope. */
  workspaceRoot?: string;
  /** Home directory for `machine` scope; defaults to `os.homedir()`. */
  homeDir?: string;
}

export interface LoadedCustomAgentSource {
  scope: CustomAgentScope;
  agents: LoadedCustomAgent[];
  issues: CustomAgentIssue[];
}

/** Root entries are scanned up to this many; the rest are reported and ignored. */
const LOADER_MAX_ROOT_ENTRIES = 64;

const AGENTS_SEGMENTS = ['.chatroom', 'agents'] as const;
const SOURCE_ROOT_PATH = '.chatroom/agents';
const AGENT_FILE = 'AGENT.md';
const INBOUND_FILE = 'inbound-handoff.md';
const RETURN_FILE = 'return-handoff.md';
const AGENT_FILE_MAX_BYTES = 32 * 1024;
const HANDOFF_FILE_MAX_BYTES = CUSTOM_AGENT_LIMITS.handoffTemplateMaxBytes;
const AGENT_CAP_DETAIL = `agent cap ${CUSTOM_AGENT_LIMITS.agentsPerSource}`;

type RootResolution =
  { ok: true; rootPath: string | null } | { ok: false; issues: CustomAgentIssue[] };

type ParsedAgent = Extract<ReturnType<typeof parseAgentFile>, { ok: true }>;

interface SourceScan {
  agents: LoadedCustomAgent[];
  issues: CustomAgentIssue[];
}

interface EntryResult {
  agents: LoadedCustomAgent[];
  issues: CustomAgentIssue[];
}

interface TemplateReads {
  inbound?: string;
  returned?: string;
  issues: CustomAgentIssue[];
}

/**
 * Load one source root. A missing root is an empty source, not an error.
 */
export async function loadCustomAgentSource(
  input: LoadCustomAgentSourceInput
): Promise<LoadedCustomAgentSource> {
  const root = await resolveSourceRoot(input);
  if (!root.ok) return emptySource(input.scope, root.issues);
  if (root.rootPath === null) return emptySource(input.scope, []);

  const scan = await scanRoot(root.rootPath);
  return await withGitIgnoredIssue(input, buildSource(input.scope, scan));
}

function emptySource(
  scope: CustomAgentScope,
  issues: readonly CustomAgentIssue[]
): LoadedCustomAgentSource {
  return { scope, agents: [], issues: sortIssues(issues) };
}

function buildSource(scope: CustomAgentScope, scan: SourceScan): LoadedCustomAgentSource {
  const capped = enforceAgentCap(scan.agents);
  return {
    scope,
    agents: capped.agents,
    issues: sortIssues([...scan.issues, ...capped.issues]),
  };
}

// ─── Git visibility ──────────────────────────────────────────────────────────

/**
 * Advisory check: a workspace agent that git ignores can never be committed, so
 * its definition would exist only on this machine. The agents still load; the
 * source carries one `gitignored` issue so the user can fix `.gitignore`.
 *
 * Only workspace scope has a repository to check, and only when
 * `<workspaceRoot>/.git` exists (a directory, or the file a worktree uses).
 */
async function withGitIgnoredIssue(
  input: LoadCustomAgentSourceInput,
  source: LoadedCustomAgentSource
): Promise<LoadedCustomAgentSource> {
  try {
    const gitRoot = await resolveGitRoot(input, source);
    if (gitRoot === null) return source;
    return await addGitIgnoredIssue(gitRoot, source);
  } catch {
    // Visibility is advisory; a matcher failure must never fail the load.
    return source;
  }
}

async function resolveGitRoot(
  input: LoadCustomAgentSourceInput,
  source: LoadedCustomAgentSource
): Promise<string | null> {
  if (source.scope !== 'workspace') return null;
  const root = input.workspaceRoot;
  if (root === undefined) return null;
  return (await pathExists(join(root, '.git'))) ? root : null;
}

async function addGitIgnoredIssue(
  gitRoot: string,
  source: LoadedCustomAgentSource
): Promise<LoadedCustomAgentSource> {
  if (source.agents.length === 0) return source;
  const matcher = await loadGitIgnoreMatcher(gitRoot);
  if (!hasIgnoredAgent(matcher, source.agents)) return source;
  return {
    ...source,
    issues: sortIssues([...source.issues, issue(SOURCE_ROOT_PATH, 'gitignored')]),
  };
}

function hasIgnoredAgent(matcher: Ignore, agents: readonly LoadedCustomAgent[]): boolean {
  return agents.some((agent) => matcher.ignores(agentIgnorePath(agent.name)));
}

/** The path a user would commit, relative to the repository root. */
function agentIgnorePath(name: string): string {
  return `${SOURCE_ROOT_PATH}/${name}/${AGENT_FILE}`;
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await lstat(absPath);
    return true;
  } catch {
    return false;
  }
}

// ─── Root resolution ─────────────────────────────────────────────────────────

async function resolveSourceRoot(input: LoadCustomAgentSourceInput): Promise<RootResolution> {
  try {
    const baseDir = resolveBaseDir(input);
    if (baseDir === undefined) return { ok: true, rootPath: null };
    return await resolveExistingRoot(input.scope, baseDir);
  } catch (err) {
    return classifyRootError(err);
  }
}

function resolveBaseDir(input: LoadCustomAgentSourceInput): string | undefined {
  if (input.scope === 'workspace') return input.workspaceRoot;
  return input.homeDir ?? homedir();
}

/**
 * Resolve the root and, for workspace scope, prove it is inside the resolved
 * workspace. Machine scope may resolve a symlinked `~/.chatroom` by design.
 */
async function resolveExistingRoot(
  scope: CustomAgentScope,
  baseDir: string
): Promise<RootResolution> {
  const rootPath = await realpath(join(baseDir, ...AGENTS_SEGMENTS));
  if (scope !== 'workspace') return { ok: true, rootPath };

  const basePath = await realpath(baseDir);
  if (isPathInsideRoot(basePath, rootPath)) return { ok: true, rootPath };
  return { ok: false, issues: [issue(SOURCE_ROOT_PATH, 'unreadable', 'root-outside-workspace')] };
}

/** A missing root means "no custom agents". Any other failure is reported. */
function classifyRootError(err: unknown): RootResolution {
  const code = errorCode(err);
  if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: true, rootPath: null };
  return { ok: false, issues: [issue(SOURCE_ROOT_PATH, 'unreadable', code)] };
}

// ─── Directory scanning ──────────────────────────────────────────────────────

async function scanRoot(rootPath: string): Promise<SourceScan> {
  try {
    return await scanEntries(rootPath);
  } catch (err) {
    return { agents: [], issues: [issue(SOURCE_ROOT_PATH, 'unreadable', errorCode(err))] };
  }
}

async function scanEntries(rootPath: string): Promise<SourceScan> {
  const names = (await readdir(rootPath)).sort();
  const entries: EntryResult[] = [];
  let index = 0;
  // Only agent directories use the scan budget: a stray `README.md` or a
  // `.DS_Store` is not an agent and must not push a directory out of the scan.
  while (entries.length < LOADER_MAX_ROOT_ENTRIES && index < names.length) {
    const entry = await loadRootEntry(rootPath, names[index] as string);
    if (entry !== null) entries.push(entry);
    index += 1;
  }
  return mergeEntries(entries, isTruncated(entries, index, names));
}

/** True when the scan filled its budget while entries remained unexamined. */
function isTruncated(
  entries: readonly EntryResult[],
  index: number,
  names: readonly string[]
): boolean {
  return entries.length === LOADER_MAX_ROOT_ENTRIES && index < names.length;
}

function mergeEntries(entries: readonly EntryResult[], truncated: boolean): SourceScan {
  const agents = entries.flatMap((entry) => entry.agents);
  const issues = entries.flatMap((entry) => entry.issues);
  return truncated
    ? { agents, issues: [...issues, issue(SOURCE_ROOT_PATH, 'root-truncated', 'entries')] }
    : { agents, issues };
}

/**
 * One root entry, or null when it is not an agent directory at all. Dotfiles
 * (`.DS_Store`, `.gitkeep`) and plain files (`README.md`) are skipped silently:
 * they are editor or git noise, not a user mistake worth an issue. A symlink is
 * still reported, because the loader refuses to follow one.
 */
async function loadRootEntry(rootPath: string, entryName: string): Promise<EntryResult | null> {
  if (entryName.startsWith('.')) return null;
  try {
    return await loadExistingEntry(rootPath, entryName);
  } catch (err) {
    return entryIssue(entryName, errorCode(err));
  }
}

async function loadExistingEntry(rootPath: string, entryName: string): Promise<EntryResult | null> {
  const stats = await lstat(join(rootPath, entryName));
  if (stats.isSymbolicLink()) return entryIssue(entryName, 'symlink');
  if (!stats.isDirectory()) return null;
  return await loadAgentDirectory(rootPath, entryName);
}

function entryIssue(entryName: string, detail: string): EntryResult {
  return { agents: [], issues: [issue(entryName, 'unreadable', detail)] };
}

// ─── Agent directories ───────────────────────────────────────────────────────

async function loadAgentDirectory(rootPath: string, dirName: string): Promise<EntryResult> {
  const parsed = await readAgentFrontmatter(rootPath, dirName);
  if (!parsed.ok) return { agents: [], issues: parsed.issues };
  if (parsed.value.name !== dirName) {
    return { agents: [], issues: [issue(agentFilePath(dirName), 'name-mismatch')] };
  }
  return await buildEntry(rootPath, dirName, parsed.value);
}

async function readAgentFrontmatter(
  rootPath: string,
  dirName: string
): Promise<{ ok: true; value: ParsedAgent } | { ok: false; issues: CustomAgentIssue[] }> {
  const read = await safeReadTextFile(join(rootPath, dirName, AGENT_FILE), AGENT_FILE_MAX_BYTES);
  if (!read.ok) return { ok: false, issues: [agentReadIssue(dirName, read)] };

  const parsed = parseAgentFile(read.text);
  if (!parsed.ok) return { ok: false, issues: [issue(agentFilePath(dirName), parsed.reason)] };
  return { ok: true, value: parsed };
}

/** A missing `AGENT.md` is reported as absence of frontmatter, matching the docs. */
function agentReadIssue(dirName: string, read: SafeReadFailure): CustomAgentIssue {
  if (read.reason === 'unreadable' && read.detail === 'ENOENT') {
    return issue(agentFilePath(dirName), 'missing-frontmatter');
  }
  return issue(agentFilePath(dirName), read.reason, read.detail);
}

/**
 * Assemble one accepted definition. Flagged frontmatter keys and unreadable
 * templates become issues but never drop the agent; only shared payload
 * validation can reject it.
 */
async function buildEntry(
  rootPath: string,
  dirName: string,
  parsed: ParsedAgent
): Promise<EntryResult> {
  const templates = await readTemplates(join(rootPath, dirName), dirName);
  const issues = [...templates.issues, ...flaggedKeyIssues(dirName, parsed.flaggedKeys)];
  const candidate = buildCandidate(parsed, templates);

  const validation = validateCustomAgentPayload({ ...candidate, disabled: false });
  if (validation.ok) return { agents: [candidate], issues };
  return {
    agents: [],
    issues: [...issues, issue(agentFilePath(dirName), validation.reason, validation.detail)],
  };
}

function flaggedKeyIssues(
  dirName: string,
  flaggedKeys: readonly FrontmatterFlaggedKey[]
): CustomAgentIssue[] {
  return flaggedKeys.map(({ key, reason }) => issue(agentFilePath(dirName), reason, key));
}

/**
 * The hash covers the sanitized description, the body, and the templates, which
 * is exactly what the backend stores and re-hashes.
 */
function buildCandidate(parsed: ParsedAgent, templates: TemplateReads): LoadedCustomAgent {
  const content = {
    name: parsed.name,
    description: sanitizeCustomAgentSummary(parsed.description),
    systemPrompt: parsed.body,
    ...(templates.inbound === undefined ? {} : { inboundHandoffTemplate: templates.inbound }),
    ...(templates.returned === undefined ? {} : { returnHandoffTemplate: templates.returned }),
  };
  return { ...content, contentHash: computeCustomAgentContentHash(content) };
}

// ─── Handoff templates ───────────────────────────────────────────────────────

async function readTemplates(dirPath: string, dirName: string): Promise<TemplateReads> {
  const [inbound, returned] = await Promise.all([
    readOptionalTemplate(dirPath, dirName, INBOUND_FILE),
    readOptionalTemplate(dirPath, dirName, RETURN_FILE),
  ]);
  return {
    ...(inbound.text === undefined ? {} : { inbound: inbound.text }),
    ...(returned.text === undefined ? {} : { returned: returned.text }),
    issues: [...inbound.issues, ...returned.issues],
  };
}

/** A missing template is fine; an unreadable or oversized one is reported and omitted. */
async function readOptionalTemplate(
  dirPath: string,
  dirName: string,
  fileName: string
): Promise<{ text?: string; issues: CustomAgentIssue[] }> {
  const read = await safeReadTextFile(join(dirPath, fileName), HANDOFF_FILE_MAX_BYTES);
  if (read.ok) return { text: read.text, issues: [] };
  if (read.detail === 'ENOENT') return { issues: [] };
  return { issues: [issue(`${dirName}/${fileName}`, read.reason, read.detail)] };
}

// ─── Caps, sorting, and issue shape ──────────────────────────────────────────

/** Keeps the first 12 agents by name and reports every overflow directory. */
function enforceAgentCap(agents: readonly LoadedCustomAgent[]): {
  agents: LoadedCustomAgent[];
  issues: CustomAgentIssue[];
} {
  const sorted = [...agents].sort(compareAgentNames);
  const overflow = sorted.slice(CUSTOM_AGENT_LIMITS.agentsPerSource);
  return {
    agents: sorted.slice(0, CUSTOM_AGENT_LIMITS.agentsPerSource),
    issues: overflow.map((agent) => issue(agent.name, 'root-truncated', AGENT_CAP_DETAIL)),
  };
}

function compareAgentNames(left: LoadedCustomAgent, right: LoadedCustomAgent): number {
  return compareText(left.name, right.name);
}

function sortIssues(issues: readonly CustomAgentIssue[]): CustomAgentIssue[] {
  return [...issues].sort(compareIssues).slice(0, CUSTOM_AGENT_LIMITS.issuesPerSource);
}

function compareIssues(left: CustomAgentIssue, right: CustomAgentIssue): number {
  const byPath = compareText(left.path, right.path);
  if (byPath !== 0) return byPath;
  return compareIssueTail(left, right);
}

function compareIssueTail(left: CustomAgentIssue, right: CustomAgentIssue): number {
  const byReason = compareText(left.reason, right.reason);
  if (byReason !== 0) return byReason;
  return compareText(left.detail ?? '', right.detail ?? '');
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function issue(path: string, reason: CustomAgentIssueReason, detail?: string): CustomAgentIssue {
  const cleanPath = stripControlCharacters(path);
  return detail === undefined
    ? { path: cleanPath, reason }
    : { path: cleanPath, reason, detail: stripControlCharacters(detail) };
}

/**
 * Removes C0, DEL, and C1 control characters. Issue text is printed to a
 * terminal by `chatroom custom-agents validate`, so a directory name carrying an
 * ANSI escape (for example `\u001b[31m`) must not reach the screen.
 */
function stripControlCharacters(text: string): string {
  return text.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
}

function agentFilePath(dirName: string): string {
  return `${dirName}/${AGENT_FILE}`;
}
