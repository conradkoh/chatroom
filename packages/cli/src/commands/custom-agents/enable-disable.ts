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
    deps.stdout(
      `Invalid custom agent name "${name}". Use lowercase letters, digits, and hyphens ` +
        `(max ${CUSTOM_AGENT_LIMITS.nameMaxLength} characters).`
    );
    deps.setExitCode(1);
    return;
  }
  if (!(await requestToggle(chatroomId, name, disabled, deps))) return;
  if (await waitForRosterValue(chatroomId, name, disabled, deps)) {
    deps.stdout('confirmed');
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

/** Polls the roster until the named agent shows `disabled`, or the deadline passes. */
async function waitForRosterValue(
  chatroomId: string,
  name: string,
  disabled: boolean,
  deps: ToggleCustomAgentDeps
): Promise<boolean> {
  const deadline = deps.now() + CONFIRM_TIMEOUT_MS;
  for (;;) {
    if (await rosterHasValue(chatroomId, name, disabled, deps)) return true;
    if (deps.now() >= deadline) return false;
    await deps.sleep(POLL_INTERVAL_MS);
  }
}

/** The agent is confirmed only when the roster carries it with the wanted value. */
async function rosterHasValue(
  chatroomId: string,
  name: string,
  disabled: boolean,
  deps: ToggleCustomAgentDeps
): Promise<boolean> {
  const result = (await deps.client.query(api.customAgents.getTeamRoster, {
    sessionId: deps.sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  })) as { roster: TeamRosterEntry[] };
  return result.roster.find((entry) => entry.role === name)?.disabled === disabled;
}
