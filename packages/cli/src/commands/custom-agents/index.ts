/**
 * `chatroom custom-agents` — disk inspection and roster commands.
 *
 * `validate` is offline: it loads one or both source roots and prints what the
 * daemon would see, without authenticating. `list`, `enable`, `disable`, and
 * `refresh` are authenticated and call the same backend functions the webapp's
 * Custom Agents tab uses, so the CLI adds no backend contract of its own.
 */

import { homedir } from 'node:os';

import type { CustomAgentIssue } from '@workspace/shared/domain/custom-agent';

import type { CustomAgentsDeps, ValidateCustomAgentsInput } from './deps.js';
import { setCustomAgentDisabled } from './enable-disable.js';
import { listCustomAgents } from './list.js';
import { refreshCustomAgents } from './refresh.js';
import { createConvexCommandDeps } from '../../infrastructure/deps/create-convex-command-deps.js';
import type { BackendOps } from '../../infrastructure/deps/index.js';
import {
  loadCustomAgentSource,
  type LoadCustomAgentSourceInput,
  type LoadedCustomAgentSource,
} from '../../infrastructure/services/custom-agents/index.js';

export type { CustomAgentsDeps, ValidateCustomAgentsInput } from './deps.js';

function createDefaultDeps(): CustomAgentsDeps {
  return {
    load: loadCustomAgentSource,
    cwd: () => process.cwd(),
    homeDir: () => homedir(),
    stdout: (line) => console.log(line),
    setExitCode: (code) => {
      process.exitCode = code;
    },
  };
}

/**
 * Validate the requested sources. Exit code 1 when any issue exists across the
 * sources validated, 0 otherwise.
 */
export async function validateCustomAgents(
  input: ValidateCustomAgentsInput,
  deps: CustomAgentsDeps = createDefaultDeps()
): Promise<void> {
  const targets = resolveTargets(input, deps);
  const sources = await Promise.all(targets.map((target) => deps.load(target)));

  for (const [index, target] of targets.entries()) {
    printSource(target, sources[index], deps);
  }
  deps.setExitCode(sources.some((source) => source.issues.length > 0) ? 1 : 0);
}

/**
 * Expand the flags into loader targets.
 *
 * - no flags: workspace (cwd) and machine
 * - `--workspace <dir>`: that directory as a workspace only
 * - `--machine`: machine only
 * - both: both
 */
function resolveTargets(
  input: ValidateCustomAgentsInput,
  deps: CustomAgentsDeps
): LoadCustomAgentSourceInput[] {
  return buildTargets(
    resolveWorkspaceRoot(input, deps),
    shouldIncludeMachine(input),
    deps.homeDir()
  );
}

function resolveWorkspaceRoot(
  input: ValidateCustomAgentsInput,
  deps: CustomAgentsDeps
): string | undefined {
  if (input.workspaceDir !== undefined) return input.workspaceDir;
  return input.machine ? undefined : deps.cwd();
}

/** An explicit `--workspace` with no `--machine` validates the workspace only. */
function shouldIncludeMachine(input: ValidateCustomAgentsInput): boolean {
  return input.machine || input.workspaceDir === undefined;
}

function buildTargets(
  workspaceRoot: string | undefined,
  includeMachine: boolean,
  homeDir: string
): LoadCustomAgentSourceInput[] {
  const targets: LoadCustomAgentSourceInput[] = [];
  if (workspaceRoot !== undefined) targets.push({ scope: 'workspace', workspaceRoot });
  if (includeMachine) targets.push({ scope: 'machine', homeDir });
  return targets;
}

function printSource(
  target: LoadCustomAgentSourceInput,
  source: LoadedCustomAgentSource,
  deps: CustomAgentsDeps
): void {
  deps.stdout(describeSource(target));
  if (isEmptySource(source)) {
    deps.stdout('  no agents or issues');
    deps.stdout('');
    return;
  }
  printAgents(source, deps);
  printIssues(source.issues, deps);
  deps.stdout('');
}

function isEmptySource(source: LoadedCustomAgentSource): boolean {
  return source.agents.length === 0 && source.issues.length === 0;
}

function printAgents(source: LoadedCustomAgentSource, deps: CustomAgentsDeps): void {
  for (const agent of source.agents) {
    deps.stdout(`  ${agent.name}  (${source.scope})  ${agent.description}`);
  }
}

function printIssues(issues: readonly CustomAgentIssue[], deps: CustomAgentsDeps): void {
  for (const issue of issues) deps.stdout(`  ${formatIssue(issue)}`);
}

function describeSource(target: LoadCustomAgentSourceInput): string {
  if (target.scope === 'workspace') return `workspace  ${target.workspaceRoot ?? ''}`;
  return `machine  ${target.homeDir ?? ''}`;
}

/** `reason  path  detail` with the detail column omitted when absent. */
function formatIssue(issue: CustomAgentIssue): string {
  const head = `${issue.reason}  ${issue.path}`;
  return issue.detail === undefined ? head : `${head}  ${issue.detail}`;
}

// ─── Authenticated roster commands ───────────────────────────────────────────

/** Real delays for the confirmation poll; tests inject their own. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The stored session plus the backend it authorizes, or null after printing the
 * login hint. Every roster command needs both, and the client is a singleton, so
 * one call covers either command.
 */
async function loadRosterContext(): Promise<{ sessionId: string; backend: BackendOps } | null> {
  const deps = await createConvexCommandDeps();
  const sessionId = await deps.session.getSessionId();
  if (sessionId !== null) return { sessionId, backend: deps.backend };
  console.error('Not authenticated. Run `chatroom auth login` first.');
  process.exitCode = 1;
  return null;
}

/** `chatroom custom-agents list`. */
export async function listCustomAgentsCommand(chatroomId: string): Promise<void> {
  const context = await loadRosterContext();
  if (context === null) return;
  await listCustomAgents(chatroomId, {
    client: context.backend,
    sessionId: context.sessionId,
    stdout: (line) => console.log(line),
  });
}

/** `chatroom custom-agents enable|disable`. */
export async function setCustomAgentDisabledCommand(
  chatroomId: string,
  name: string,
  disabled: boolean
): Promise<void> {
  const context = await loadRosterContext();
  if (context === null) return;
  await setCustomAgentDisabled(chatroomId, name, disabled, {
    client: context.backend,
    sessionId: context.sessionId,
    stdout: (line) => console.log(line),
    setExitCode: (code) => {
      process.exitCode = code;
    },
    now: Date.now,
    sleep: defaultSleep,
  });
}

/** `chatroom custom-agents refresh`. */
export async function refreshCustomAgentsCommand(chatroomId: string): Promise<void> {
  const context = await loadRosterContext();
  if (context === null) return;
  await refreshCustomAgents(chatroomId, {
    client: context.backend,
    sessionId: context.sessionId,
    stdout: (line) => console.log(line),
    setExitCode: (code) => {
      process.exitCode = code;
    },
  });
}
