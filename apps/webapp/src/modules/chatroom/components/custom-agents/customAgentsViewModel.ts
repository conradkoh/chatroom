// fallow-ignore-file unused-file unused-export
/**
 * Pure view model for the Custom Agents settings tab.
 *
 * Turns one `customAgents.getTeamRoster` result into the rows and the fixed
 * `[workspace, machine]` source pair the UI renders. Over-limit and shadowed
 * agents are never roster flags: they exist only as issues on the owning
 * source, so this module reads them from there.
 *
 * No React and no state: the caller re-derives the model whenever the roster
 * changes, and `changeSignature` tells it whether anything visible moved.
 *
 * Temporary: S6b wires this into the tab and removes this marker.
 */

import type { api } from '@workspace/backend/convex/_generated/api';
import type { CustomAgentIssue, CustomAgentScope } from '@workspace/shared/domain/custom-agent';
import type { FunctionReturnType } from 'convex/server';

export type TeamRosterResult = FunctionReturnType<typeof api.customAgents.getTeamRoster>;
export type CustomAgentSourceView = TeamRosterResult['sources'][number];
type RosterEntry = TeamRosterResult['roster'][number];
/** A custom roster entry always carries its scope; the shared type makes it optional. */
type CustomRosterEntry = RosterEntry & { scope: CustomAgentScope };

export interface CustomAgentRowModel {
  name: string;
  /** `TeamRosterEntry.summary`, already sanitised server-side. */
  description: string;
  scope: CustomAgentScope;
  disabled: boolean;
  disableable: boolean;
  overridesMachineCopy: boolean;
}

export interface CustomAgentSourceModel {
  scope: CustomAgentScope;
  rootPath: string;
  pushed: CustomAgentSourceView | null;
  issues: CustomAgentIssue[];
}

export interface CustomAgentsViewModel {
  rows: CustomAgentRowModel[];
  /** Always `[workspace, machine]`, in that order. */
  sources: [CustomAgentSourceModel, CustomAgentSourceModel];
  enabledCount: number;
  disabledCount: number;
  issueCount: number;
  changeSignature: string;
}

export const MACHINE_AGENTS_ROOT = '~/.chatroom/agents';

/** The workspace agents directory, matching the daemon's loader root. */
export function workspaceAgentsRoot(workingDir: string): string {
  return `${workingDir.replace(/\/+$/, '')}/.chatroom/agents`;
}

export function buildCustomAgentsViewModel(
  result: TeamRosterResult,
  workingDir: string
): CustomAgentsViewModel {
  const rows = buildRows(result.roster, shadowedMachineNames(result.sources));
  const sources = buildSources(result.sources, workingDir);

  return {
    rows,
    sources,
    enabledCount: rows.filter((row) => !row.disabled).length,
    disabledCount: rows.filter((row) => row.disabled).length,
    issueCount: sources.reduce((total, source) => total + source.issues.length, 0),
    changeSignature: buildChangeSignature(rows, sources),
  };
}

function isCustomRosterEntry(entry: RosterEntry): entry is CustomRosterEntry {
  return entry.source === 'custom' && entry.scope !== undefined;
}

/** Custom rows only, sorted by name. A toggle never re-sorts them. */
function buildRows(
  roster: readonly RosterEntry[],
  shadowedNames: ReadonlySet<string>
): CustomAgentRowModel[] {
  return roster
    .filter(isCustomRosterEntry)
    .map((entry) => toRow(entry, shadowedNames))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function toRow(entry: CustomRosterEntry, shadowedNames: ReadonlySet<string>): CustomAgentRowModel {
  return {
    name: entry.role,
    description: entry.summary,
    scope: entry.scope,
    disabled: entry.disabled,
    disableable: entry.disableable,
    overridesMachineCopy: entry.scope === 'workspace' && shadowedNames.has(entry.role),
  };
}

/** Names the machine source reports as shadowed by a workspace agent. */
function shadowedMachineNames(sources: readonly CustomAgentSourceView[]): ReadonlySet<string> {
  const machine = sources.find((source) => source.scope === 'machine');
  const issues = machine?.issues ?? [];
  return new Set(issues.filter((issue) => issue.reason === 'shadowed').map((issue) => issue.path));
}

function buildSources(
  sources: readonly CustomAgentSourceView[],
  workingDir: string
): [CustomAgentSourceModel, CustomAgentSourceModel] {
  return [
    buildSource('workspace', workspaceAgentsRoot(workingDir), sources),
    buildSource('machine', MACHINE_AGENTS_ROOT, sources),
  ];
}

function buildSource(
  scope: CustomAgentScope,
  rootPath: string,
  sources: readonly CustomAgentSourceView[]
): CustomAgentSourceModel {
  const pushed = sources.find((source) => source.scope === scope) ?? null;
  return { scope, rootPath, pushed, issues: pushed?.issues ?? [] };
}

/** Changes only when a visible fact changes: updatedAt, disabled, or issue count. */
function buildChangeSignature(
  rows: readonly CustomAgentRowModel[],
  sources: readonly CustomAgentSourceModel[]
): string {
  return JSON.stringify([
    rows.map((row) => [row.name, row.scope, row.disabled]),
    sources.map(sourceSignature),
  ]);
}

function sourceSignature(source: CustomAgentSourceModel): unknown[] {
  return [source.scope, ...pushedSignature(source.pushed), source.issues.length];
}

function pushedSignature(pushed: CustomAgentSourceView | null): [number | null, number | null] {
  if (pushed === null) return [null, null];
  return [pushed.updatedAt, pushed.agentCount];
}
