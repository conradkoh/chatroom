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
  if (outcome === 'confirmed') {
    deps.stdout('confirmed');
    return;
  }
  if (outcome === 'over-limit') {
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

type PollOutcome = 'confirmed' | 'over-limit' | 'timeout';

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
    if (outcome !== 'pending') return outcome;
    if (deps.now() >= deadline) return 'timeout';
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
): Promise<'pending' | 'confirmed' | 'over-limit'> {
  const result = (await deps.client.query(api.customAgents.getTeamRoster, {
    sessionId: deps.sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  })) as RosterResult;

  if (rosterHasValue(result.roster, name, disabled)) return 'confirmed';
  // Enabling an over-limit agent is the only case where waiting cannot succeed.
  if (!disabled && isOverLimit(result.sources, name)) return 'over-limit';
  return 'pending';
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
  return (sources ?? []).some((source) =>
    (source.issues ?? []).some((issue) => namesAgent(issue, name))
  );
}

/**
 * True only when this issue names the agent. `over-limit` issues carry no
 * detail, and free prose in `detail` is never a match key: an issue for
 * `reviewer` must not make `rev` look over the cap.
 */
function namesAgent(issue: CustomAgentIssue, name: string): boolean {
  if (issue.reason !== 'over-limit') return false;
  return issue.path === name;
}
