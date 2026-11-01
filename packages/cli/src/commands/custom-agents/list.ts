/**
 * `chatroom custom-agents list` — the roster the daemon last pushed.
 *
 * Reads `customAgents.getTeamRoster` and prints plain text: one line per custom
 * agent, then one line per source, then every issue. No colour codes and no
 * cursor control, so the output stays safe in a log or a pipe.
 */

import type {
  CustomAgentIssue,
  CustomAgentScope,
  TeamRosterEntry,
} from '@workspace/shared/domain/custom-agent';

import { api, type Id } from '../../api.js';
import { sanitizeForTerminal } from '../../utils/terminal-safety.js';

/** The slice of the Convex client this command uses; tests inject a fake. */
export interface CustomAgentsListClient {
  query: (endpoint: unknown, args: unknown) => Promise<unknown>;
}

export interface ListCustomAgentsDeps {
  client: CustomAgentsListClient;
  sessionId: string;
  stdout: (line: string) => void;
}

/** One pushed source snapshot, as `getTeamRoster` returns it. */
interface RosterSource {
  scope: CustomAgentScope;
  workingDir?: string | undefined;
  agentCount: number;
  issues: CustomAgentIssue[];
}

interface RosterResult {
  roster: TeamRosterEntry[];
  sources: RosterSource[];
}

const ISSUE_INDENT = '  ';

export async function listCustomAgents(
  chatroomId: string,
  deps: ListCustomAgentsDeps
): Promise<void> {
  const roster = await readRoster(chatroomId, deps);
  for (const line of renderRoster(roster)) deps.stdout(line);
}

async function readRoster(chatroomId: string, deps: ListCustomAgentsDeps): Promise<RosterResult> {
  return (await deps.client.query(api.customAgents.getTeamRoster, {
    sessionId: deps.sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  })) as RosterResult;
}

/** Every line of the report, in the order it is printed. */
function renderRoster(roster: RosterResult): string[] {
  const agents = roster.roster.filter((entry) => entry.source === 'custom');
  return [
    'Custom agents',
    ...renderAgents(agents, roster.sources),
    '',
    'Sources',
    ...renderSources(roster.sources),
    '',
    'Issues',
    ...renderIssues(roster.sources),
  ];
}

function renderAgents(
  agents: readonly TeamRosterEntry[],
  sources: readonly RosterSource[]
): string[] {
  if (agents.length === 0) return [`${ISSUE_INDENT}no custom agents`];
  const rows = agents.map((agent) => [
    sanitizeForTerminal(agent.role),
    agent.scope ?? 'unknown',
    // The webapp shows a switch that is on when the agent is usable, so the
    // column follows the switch rather than repeating the stored flag.
    agent.disabled ? 'no' : 'yes',
    String(issueCountFor(agent.role, sources)),
  ]);
  return formatTable(['NAME', 'SCOPE', 'ENABLED', 'ISSUES'], rows);
}

/** Issues whose path names this agent: its own file, or a directory-level issue. */
function issueCountFor(role: string, sources: readonly RosterSource[]): number {
  return sources.reduce((total, source) => total + countAgentIssues(source.issues, role), 0);
}

function countAgentIssues(issues: readonly CustomAgentIssue[], role: string): number {
  return issues.filter((issue) => issue.path === role || issue.path.startsWith(`${role}/`)).length;
}

function renderSources(sources: readonly RosterSource[]): string[] {
  if (sources.length === 0) return [`${ISSUE_INDENT}no sources pushed`];
  const rows = sources.map((source) => [
    source.scope,
    sanitizeForTerminal(source.workingDir ?? 'machine'),
    source.issues.length === 0 ? 'ok' : 'with issues',
    `${source.agentCount} agents`,
  ]);
  return formatTable(['SCOPE', 'LOCATION', 'STATUS', 'AGENTS'], rows);
}

function renderIssues(sources: readonly RosterSource[]): string[] {
  const lines = sources.flatMap((source) =>
    source.issues.map((issue) => `${ISSUE_INDENT}${source.scope}  ${formatIssue(issue)}`)
  );
  return lines.length === 0 ? [`${ISSUE_INDENT}none`] : lines;
}

/** `path  detail`, with the detail column omitted when the issue has none. */
function formatIssue(issue: CustomAgentIssue): string {
  const head = sanitizeForTerminal(issue.path);
  if (issue.detail === undefined) return `${head}  ${issue.reason}`;
  return `${head}  ${issue.reason}  ${sanitizeForTerminal(issue.detail)}`;
}

/** Fixed-width columns, two spaces apart, with no trailing spaces on any row. */
function formatTable(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...rows.map((row) => (row[index] ?? '').length))
  );
  return [header, ...rows].map((row) =>
    row
      .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)))
      .join('  ')
      .trimEnd()
  );
}
