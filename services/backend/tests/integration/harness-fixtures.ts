/** Shared workspace fixtures for harness-backed integration tests. */

import type { SessionId } from 'convex-helpers/server/sessions';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { t } from '../../test.setup';
import {
  createTestSession,
  createDuoTeamChatroom,
  createPlannerBuilderDuoChatroom,
  createSoloTeamChatroom,
  registerMachineWithDaemon,
} from '../helpers/integration';

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
type WorkspaceSetup = {
  sessionId: SessionId;
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  workspaceId: Id<'chatroom_workspaces'>;
};

async function setupWorkspaceForTeam(
  prefix: string | undefined,
  team: 'duo' | 'duo-planner' | 'solo'
): Promise<WorkspaceSetup> {
  const p = prefix ?? uniquePrefix();
  const { sessionId } = await createTestSession(`${p}-session`);
  const chatroomId =
    team === 'solo'
      ? await createSoloTeamChatroom(sessionId)
      : team === 'duo-planner'
        ? await createPlannerBuilderDuoChatroom(sessionId)
        : await createDuoTeamChatroom(sessionId);
  const machineId = `${p}-machine`;

  await registerMachineWithDaemon(sessionId, machineId);

  // Register the workspace (links machine + cwd to the chatroom)
  await t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir: TEST_CWD,
    hostname: 'test-host',
    registeredBy: team === 'solo' ? 'solo' : 'builder',
  });

  // Record a chatroom observation so listWorkspacesForMachine
  // includes this workspace (7-day recency filter)
  await t.mutation(api.chatrooms.recordChatroomObservation, {
    sessionId,
    chatroomId,
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

export async function setupWorkspaceForSession(prefix?: string): Promise<WorkspaceSetup> {
  return setupWorkspaceForTeam(prefix, 'duo');
}

export async function setupSoloWorkspaceForSession(prefix?: string): Promise<WorkspaceSetup> {
  return setupWorkspaceForTeam(prefix, 'solo');
}

export async function setupPlannerWorkspaceForSession(prefix?: string): Promise<WorkspaceSetup> {
  return setupWorkspaceForTeam(prefix, 'duo-planner');
}
