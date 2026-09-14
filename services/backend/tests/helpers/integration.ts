/**
 * Shared Integration Test Helpers
 *
 * Common setup utilities used across agent reliability integration tests.
 * Centralizes session creation, chatroom setup, machine registration,
 * and agent config helpers to avoid duplication.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { expect } from 'vitest';

import { getInboxCommandsForMachine } from './machine-command-inbox';
import { TEST_MODEL_OPENCODE, TEST_MODEL_OPENCODE_LEGACY } from './test-models';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import type { MutationCtx } from '../../convex/_generated/server';
import { t } from '../../test.setup';

export async function setAgentRuntimeState(
  configId: Id<'chatroom_agentDesiredConfigs'>,
  patch: Record<string, unknown>
): Promise<void> {
  await t.run(async (ctx) => setAgentRuntimeStateInContext(ctx, configId, patch));
}

export async function setAgentRuntimeStateInContext(
  ctx: MutationCtx,
  configId: Id<'chatroom_agentDesiredConfigs'>,
  patch: Record<string, unknown>
): Promise<void> {
  const config = await ctx.db.get('chatroom_agentDesiredConfigs', configId);
  if (!config) return;
  const existing = await ctx.db
    .query('chatroom_agentRuntimeStates')
    .withIndex('by_desiredConfig', (q) => q.eq('desiredConfigId', configId))
    .first();
  if (existing) await ctx.db.patch('chatroom_agentRuntimeStates', existing._id, patch);
  else {
    await ctx.db.insert('chatroom_agentRuntimeStates', {
      desiredConfigId: configId,
      chatroomId: config.chatroomId,
      role: config.role,
      machineId: config.machineId,
      status: 'offline',
      updatedAt: Date.now(),
      ...patch,
    } as any);
  }
}

// ---------------------------------------------------------------------------
// Session & Chatroom
// ---------------------------------------------------------------------------

/**
 * Create and authenticate a test session via anonymous login.
 */
export async function createTestSession(sessionId: string): Promise<{ sessionId: SessionId }> {
  const login = await t.mutation(api.auth.loginAnon, {
    sessionId: sessionId as SessionId,
  });
  expect(login.success).toBe(true);
  return { sessionId: sessionId as SessionId };
}

/**
 * Create a duo team chatroom (planner + builder, entry point = planner).
 */
export async function createDuoTeamChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'builder',
  });
}

/** Create a solo team chatroom (solo, entry point = solo). */
export async function createSoloTeamChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'solo',
    teamName: 'Solo Team',
    teamRoles: ['solo'],
    teamEntryPoint: 'solo',
  });
}

/**
 * Duo team with builder as entry point — for tests that exercise builder task FSM
 * without a planner handoff step.
 */
export async function createBuilderEntryDuoChatroom(
  sessionId: SessionId
): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'builder',
  });
}

/**
 * Create a production-accurate duo team chatroom (planner + builder, entry point = planner).
 * Matches the real Duo team template used in production.
 */
export async function createPlannerBuilderDuoChatroom(
  sessionId: SessionId
): Promise<Id<'chatroom_rooms'>> {
  return await t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Duo Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

// ---------------------------------------------------------------------------
// Participants
// ---------------------------------------------------------------------------

/**
 * Join a participant to a chatroom with a given readyUntil timestamp.
 */
export async function joinParticipant(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<void> {
  await t.mutation(api.participants.join, {
    sessionId,
    chatroomId,
    role,
  });
}

// ---------------------------------------------------------------------------
// Machine & Agent Config
// ---------------------------------------------------------------------------

/**
 * Register a machine and mark its daemon as connected.
 */
export async function registerMachineWithDaemon(
  sessionId: SessionId,
  machineId: string
): Promise<{ machineId: string }> {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode'],
    availableModels: { opencode: [TEST_MODEL_OPENCODE] },
  });
  await t.mutation(api.machines.markDaemonOnline, {
    sessionId,
    machineId,
  });
  return { machineId };
}

/** Register a workspace and explicitly opt it into file-tree synchronization. */
export async function registerWorkspaceWithFileTreeSync(
  sessionId: SessionId,
  machineId: string,
  workingDir: string
): Promise<Id<'chatroom_workspaces'>> {
  const chatroomId = await createDuoTeamChatroom(sessionId);
  const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir,
    hostname: 'test-host',
    registeredBy: 'test',
  });
  await t.mutation(api.workspaces.setFileTreeSyncEnabled, {
    sessionId,
    workspaceId,
    enabled: true,
  });
  return workspaceId;
}

/**
 * Set up a remote agent config so auto-restart knows this is a remote agent.
 * Sends a start-agent command and immediately acks it so no pending commands remain.
 * The agent is NOT joined as a participant (offline).
 */
export async function setupRemoteAgentConfig(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  role: string,
  options?: { agentHarness?: string | undefined; workingDir?: string | undefined }
): Promise<void> {
  // Start agent via sendCommand to create both team and machine agent configs
  await t.mutation(api.machines.sendCommand, {
    sessionId,
    machineId,
    type: 'start-agent',
    payload: {
      chatroomId,
      role,
      model: TEST_MODEL_OPENCODE_LEGACY,
      agentHarness: options?.agentHarness ?? 'opencode',
      workingDir: options?.workingDir ?? '/test/workspace',
    },
  });
  // Note: sendCommand for start-agent now emits an agent.requestStart event to the
  // event stream. No chatroom_machineCommands acking is needed (table removed in Phase D).
}

/**
 * Register a spawned PID on a team config using the current lifecycle revision.
 */
export async function updateSpawnedAgentInTest(
  sessionId: SessionId,
  machineId: string,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  pid: number
): Promise<void> {
  const result = await t.mutation(api.machines.updateSpawnedAgent, {
    sessionId,
    machineId,
    chatroomId,
    role,
    pid,
  });
  expect(result.accepted).toBe(true);
}

/**
 * After setupRemoteAgentConfig, mark the agent as running with a test PID.
 */
export async function seedRunningAgentPid(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string,
  role: string,
  pid = 4242
): Promise<void> {
  await updateSpawnedAgentInTest(sessionId, machineId, chatroomId, role, pid);
}

/**
 * Patch chatroom teamRoles to include enhancer for enhancer integration tests.
 */
export async function enableEnhancerTeamAgent(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  machineId: string
): Promise<void> {
  await addEnhancerToTeamRoles(chatroomId);
  const workspaces = await t.query(api.workspaces.listWorkspacesForMachine, {
    sessionId,
    machineId,
  });
  const workspace = workspaces.find((candidate) => candidate.chatroomId === chatroomId);
  if (!workspace) throw new Error('Workspace not found for enhancer configuration');
  await t.mutation(api.agents.saveConfig, {
    sessionId,
    chatroomId,
    workspaceId: workspace._id,
    role: 'enhancer',
    machineId,
    agentHarness: 'opencode',
    model: 'anthropic/claude-opus-4',
    workingDir: workspace.workingDir,
  });
}

export async function addEnhancerToTeamRoles(chatroomId: Id<'chatroom_rooms'>): Promise<void> {
  await t.run(async (ctx) => {
    const room = await ctx.db.get('chatroom_rooms', chatroomId);
    if (!room) return;
    const roles = new Set(room.teamRoles ?? []);
    roles.add('planner');
    roles.add('builder');
    roles.add('enhancer');
    await ctx.db.patch(chatroomId, { teamRoles: [...roles] });
  });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Get command events (agent.requestStart / daemon.ping) from the event stream for a machine.
 */
/**
 * Assert chatroom has only duo team roles (planner, builder).
 * Used in task-transition-matrix tests to verify persistent vs ephemeral role invariants.
 */
export async function assertDuoTeamOnly(chatroomId: Id<'chatroom_rooms'>): Promise<void> {
  await t.run(async (ctx) => {
    const room = await ctx.db.get('chatroom_rooms', chatroomId);
    const roles = [...(room?.teamRoles ?? [])].sort();
    expect(roles).toEqual(['builder', 'planner']);
  });
}

export async function getCommandEvents(_sessionId: SessionId, machineId: string) {
  const rows = await getInboxCommandsForMachine(machineId);
  return rows.map((row) => ({
    _id: row._id,
    _creationTime: row.createdAt,
    machineId: row.machineId,
    deadline: row.deadline,
    timestamp: row.createdAt,
    ...row.command,
  }));
}
