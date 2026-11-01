/**
 * `chatroom custom-agents validate` — offline inspection of on-disk agents.
 *
 * Loads one or both source roots (workspace and machine) and prints every
 * loaded agent and every issue, then sets a non-zero exit code when anything
 * was reported. The command never authenticates and never talks to the backend:
 * it answers "what would the daemon see on this machine?" from disk alone.
 */

import { homedir } from 'node:os';

import type { CustomAgentIssue } from '@workspace/shared/domain/custom-agent';

import type { CustomAgentsDeps, ValidateCustomAgentsInput } from './deps.js';
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
