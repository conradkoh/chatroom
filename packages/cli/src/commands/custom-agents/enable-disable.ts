/**
 * `chatroom custom-agents enable|disable` — ask the daemon to change one flag.
 *
 * A toggle is intent only. `customAgents.setDisabled` enqueues a machine command
 * and patches no row, so the requested value is confirmed by the next roster the
 * daemon pushes. The command polls `getTeamRoster` once a second for up to ten
 * seconds, mirroring the webapp's Custom Agents tab.
 */

import {
  CUSTOM_AGENT_LIMITS,
  validateCustomAgentName,
  type CustomAgentIssue,
  type TeamRosterEntry,
} from '@workspace/shared/domain/custom-agent';

import { api, type Id } from '../../api.js';
import { getErrorMessage } from '../../utils/convex-error.js';

/** The slice of the Convex client this command uses; tests inject a fake. */
export interface CustomAgentsToggleClient {
  query: (endpoint: unknown, args: unknown) => Promise<unknown>;
  mutation: (endpoint: unknown, args: unknown) => Promise<unknown>;
}

export interface ToggleCustomAgentDeps {
  client: CustomAgentsToggleClient;
  sessionId: string;
  stdout: (line: string) => void;
  setExitCode: (code: number) => void;
  /** Clock and delay, injectable so tests never wait in real time. */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const POLL_INTERVAL_MS = 1_000;
const CONFIRM_TIMEOUT_MS = 10_000;

export async function setCustomAgentDisabled(
  chatroomId: string,
  name: string,
  disabled: boolean,
  deps: ToggleCustomAgentDeps
): Promise<void> {
  if (!isRequestableName(name)) {
    reportInvalidName(name, deps);
    return;
  }
  if (!(await requestToggle(chatroomId, name, disabled, deps))) return;
  reportOutcome(await waitForRosterValue(chatroomId, name, disabled, deps), deps);
}

function reportInvalidName(name: string, deps: ToggleCustomAgentDeps): void {
  deps.stdout(
    `Invalid custom agent name "${name}". Use lowercase letters, digits, and hyphens ` +
      `(max ${CUSTOM_AGENT_LIMITS.nameMaxLength} characters).`
  );
  deps.setExitCode(1);
}

function reportOutcome(outcome: PollOutcome, deps: ToggleCustomAgentDeps): void {
  if (outcome.kind === 'confirmed') {
    deps.stdout('confirmed');
    reportDisplaced(outcome.displaced, deps);
    return;
  }
  if (outcome.kind === 'over-limit') {
    // The change is applied; the agent simply cannot join until a slot frees.
    deps.stdout(
      `enabled, but it is over the custom-agent limit of ${CUSTOM_AGENT_LIMITS.agentsPerChatroom} ` +
        'and is not used until another agent is disabled'
    );
    return;
  }
  deps.stdout('timed out waiting for the daemon; the change is still pending');
  deps.setExitCode(1);
}

/**
 * Reports agents an enable pushed past the cap. They keep their stored enabled
 * flag, so the wording is the same as the webapp's displaced-agent copy: not in
 * use now, joins by itself once another agent is turned off.
 */
function reportDisplaced(names: readonly string[], deps: ToggleCustomAgentDeps): void {
  for (const name of names) {
    deps.stdout(
      `not in use: ${name} — the chatroom already runs ` +
        `${CUSTOM_AGENT_LIMITS.agentsPerChatroom} custom agents. ` +
        'It joins when another one is turned off.'
    );
  }
}

/**
 * Malformed names never reach the backend. A *reserved* name (a builtin role)
 * does reach it: the command has no builtin list, and the backend's
 * `CUSTOM_AGENT_NOT_FOUND` message is the answer the user should see.
 */
function isRequestableName(name: string): boolean {
  return validateCustomAgentName(name) !== 'invalid-name';
}

/** Sends the command; returns false when the backend rejected it. */
async function requestToggle(
  chatroomId: string,
  name: string,
  disabled: boolean,
  deps: ToggleCustomAgentDeps
): Promise<boolean> {
  try {
    await deps.client.mutation(api.customAgents.setDisabled, {
      sessionId: deps.sessionId,
      chatroomId: chatroomId as Id<'chatroom_rooms'>,
      name,
      disabled,
    });
    return true;
  } catch (error) {
    deps.stdout(getErrorMessage(error));
    deps.setExitCode(1);
    return false;
  }
}

type PollOutcome =
  { kind: 'confirmed'; displaced: string[] } | { kind: 'over-limit' } | { kind: 'timeout' };

/** Polls the roster until the named agent shows `disabled`, or the deadline passes. */
async function waitForRosterValue(
  chatroomId: string,
  name: string,
  disabled: boolean,
  deps: ToggleCustomAgentDeps
): Promise<PollOutcome> {
  const deadline = deps.now() + CONFIRM_TIMEOUT_MS;
  for (;;) {
    const outcome = await readRosterOutcome(chatroomId, name, disabled, deps);
    if (outcome.kind !== 'pending') return outcome;
    if (deps.now() >= deadline) return { kind: 'timeout' };
    await deps.sleep(POLL_INTERVAL_MS);
  }
}

/**
 * What the roster currently says. An agent past the per-chatroom cap is removed
 * by `mergeTeamStructureWithCustomAgents`, so it never appears as a row; the
 * `over-limit` issue is the only evidence that the enable was applied.
 */
async function readRosterOutcome(
  chatroomId: string,
  name: string,
  disabled: boolean,
  deps: ToggleCustomAgentDeps
): Promise<{ kind: 'pending' } | PollOutcome> {
  const result = (await deps.client.query(api.customAgents.getTeamRoster, {
    sessionId: deps.sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  })) as RosterResult;

  if (rosterHasValue(result.roster, name, disabled))
    return confirmedOutcome(result, name, disabled);
  // Enabling an over-limit agent is the only case where waiting cannot succeed.
  if (!disabled && isOverLimit(result.sources, name)) return { kind: 'over-limit' };
  return { kind: 'pending' };
}

/** A disable frees a slot, so only an enable can displace another agent. */
function confirmedOutcome(result: RosterResult, name: string, disabled: boolean): PollOutcome {
  return {
    kind: 'confirmed',
    displaced: disabled ? [] : displacedAgents(result.sources, name),
  };
}

interface RosterResult {
  roster: TeamRosterEntry[];
  sources?: { issues?: CustomAgentIssue[] }[] | undefined;
}

/** The roster confirms the change only when it carries the agent with that value. */
function rosterHasValue(
  roster: readonly TeamRosterEntry[],
  name: string,
  disabled: boolean
): boolean {
  return roster.some((entry) => entry.role === name && entry.disabled === disabled);
}

/** True when a source reports the agent as past the per-chatroom cap. */
function isOverLimit(
  sources: readonly { issues?: CustomAgentIssue[] }[] | undefined,
  name: string
): boolean {
  return overLimitPaths(sources).includes(name);
}

/**
 * Every agent name the sources report past the per-chatroom cap. The issue
 * `path` is the agent name and the only match key: free prose in `detail` never
 * counts, so an issue for `reviewer` cannot make `rev` look over the cap.
 */
function overLimitPaths(sources: readonly { issues?: CustomAgentIssue[] }[] | undefined): string[] {
  return (sources ?? []).flatMap((source) =>
    (source.issues ?? []).filter(isOverLimitIssue).map((issue) => issue.path)
  );
}

function isOverLimitIssue(issue: CustomAgentIssue): boolean {
  return issue.reason === 'over-limit';
}

/**
 * Agents past the cap other than the one just enabled. The merge removes them
 * from the roster but their enable is still stored, so the command reports each
 * one as not in use rather than leaving it to vanish without a word.
 */
function displacedAgents(
  sources: readonly { issues?: CustomAgentIssue[] }[] | undefined,
  toggled: string
): string[] {
  const paths = new Set(overLimitPaths(sources));
  return [...paths].filter((path) => path !== toggled).sort();
}
