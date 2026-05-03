/**
 * Shared fixtures for direct-harness integration tests.
 */

import type { SessionId } from 'convex-helpers/server/sessions';

import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { t } from '../../../test.setup';
import {
  createTestSession,
  createPairTeamChatroom,
  registerMachineWithDaemon,
} from '../../helpers/integration';

export const TEST_CWD = '/home/test/repo';
export const TEST_HARNESS_NAME = 'opencode-sdk';

let _prefixCounter = 0;
/** Generate a unique short prefix for each call site. */
function uniquePrefix(hint = 'test'): string {
  _prefixCounter += 1;
  return `${hint}-${_prefixCounter}`;
}

/**
 * Set up a session, chatroom, machine, and registered workspace.
 * Returns the workspaceId for use in openSession calls.
 *
 * @param prefix - Optional override; auto-generated when omitted.
 */
export async function setupWorkspaceForSession(prefix?: string): Promise<{
  sessionId: SessionId;
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  workspaceId: Id<'chatroom_workspaces'>;
}> {
  const p = prefix ?? uniquePrefix();
  const { sessionId } = await createTestSession(`${p}-session`);
  const chatroomId = await createPairTeamChatroom(sessionId);
  const machineId = `${p}-machine`;

  await registerMachineWithDaemon(sessionId, machineId);

  // Register the workspace (links machine + cwd to the chatroom)
  await t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir: TEST_CWD,
    hostname: 'test-host',
    registeredBy: 'builder',
  });

  // Find the workspace ID
  const workspaces = await t.query(api.workspaces.listWorkspacesForMachine, {
    sessionId,
    machineId,
  });
  const workspace = workspaces.find(
    (w) => w.workingDir === TEST_CWD && w.chatroomId === chatroomId
  );
  if (!workspace) throw new Error('Workspace not found after registration');

  return { sessionId, chatroomId, machineId, workspaceId: workspace._id };
}

/** Shared helper to open a session using the workspaceId-based API. */
export async function openSession(
  sessionId: SessionId,
  workspaceId: Id<'chatroom_workspaces'>,
  agent = 'builder'
) {
  return t.mutation(api.chatroom.directHarness.sessions.openSession, {
    sessionId,
    workspaceId,
    harnessName: TEST_HARNESS_NAME,
    config: { agent },
    firstPrompt: { parts: [{ type: 'text' as const, text: `Starting session as ${agent}` }] },
  });
}
