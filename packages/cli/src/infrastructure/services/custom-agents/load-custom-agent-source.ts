// fallow-ignore-file unused-file
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
 *
 * Not reachable from a CLI entry point yet: a later slice wires this into the
 * daemon sync path. The dead-code suppression above covers that gap; remove it
 * when the caller lands.
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

import { parseAgentFile, type FrontmatterFlaggedKey } from './parse-agent-frontmatter.js';
import { errorCode, safeReadTextFile, type SafeReadFailure } from './safe-read.js';
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
export const LOADER_MAX_ROOT_ENTRIES = 64;

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
  return buildSource(input.scope, scan);
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
    const names = (await readdir(rootPath)).sort();
    const truncated = names.length > LOADER_MAX_ROOT_ENTRIES;
    const entries = await Promise.all(
      names.slice(0, LOADER_MAX_ROOT_ENTRIES).map((name) => loadRootEntry(rootPath, name))
    );
    return mergeEntries(entries, truncated);
  } catch (err) {
    return { agents: [], issues: [issue(SOURCE_ROOT_PATH, 'unreadable', errorCode(err))] };
  }
}

function mergeEntries(entries: readonly EntryResult[], truncated: boolean): SourceScan {
  const agents = entries.flatMap((entry) => entry.agents);
  const issues = entries.flatMap((entry) => entry.issues);
  return truncated
    ? { agents, issues: [...issues, issue(SOURCE_ROOT_PATH, 'root-truncated', 'entries')] }
    : { agents, issues };
}

async function loadRootEntry(rootPath: string, entryName: string): Promise<EntryResult> {
  try {
    const stats = await lstat(join(rootPath, entryName));
    if (stats.isSymbolicLink()) return entryIssue(entryName, 'symlink');
    if (!stats.isDirectory()) return entryIssue(entryName, 'not-directory');
    return await loadAgentDirectory(rootPath, entryName);
  } catch (err) {
    return entryIssue(entryName, errorCode(err));
  }
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
  return detail === undefined ? { path, reason } : { path, reason, detail };
}

function agentFilePath(dirName: string): string {
  return `${dirName}/${AGENT_FILE}`;
}
