/**
 * Tests for start-agent-from-current-config — team membership, workspace
 * selection, saved request reuse, and the custom-agent start path.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { startAgentFromCurrentWorkspaceConfig } from './start-agent-from-current-config';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { TEST_MODEL_OPENCODE } from '../../../../tests/helpers/test-models';

const WORKING_DIR = '/test/workspace';

type TestAgent = {
  name: string;
  description: string;
  systemPrompt: string;
  contentHash: string;
  disabled: boolean;
};

function makeAgent(name: string, contentHash: string): TestAgent {
  return {
    name,
    description: `${name} role.`,
    systemPrompt: `You are ${name}.`,
    contentHash,
    disabled: false,
  };
}

async function setupChatroom(suffix: string) {
  const sessionId = `start-current-${suffix}` as SessionId;
  const machineId = `start-current-machine-${suffix}`;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode'],
  });
  const { chatroomId, workspaceId } = await t.mutation(api.chatrooms.createWithWorkspace, {
    sessionId,
    teamStructureId: 'duo',
    machineId,
    workingDir: WORKING_DIR,
  });
  return {
    sessionId,
    machineId,
    chatroomId,
    workspaceId,
    userId: login.userId as Id<'users'>,
  };
}

type Setup = Awaited<ReturnType<typeof setupChatroom>>;

/** Saves a launch snapshot as the webapp would when the role is first started. */
async function saveLaunchConfig(setup: Setup, role: string) {
  await t.mutation(api.agents.requestStart, {
    sessionId: setup.sessionId,
    machineId: setup.machineId,
    chatroomId: setup.chatroomId,
    workspaceId: setup.workspaceId,
    role,
    agentHarness: 'opencode',
    model: TEST_MODEL_OPENCODE,
    workingDir: WORKING_DIR,
  });
}

async function startFromCurrentConfig(
  setup: Setup,
  role: string,
  options?: { workspaceId?: Id<'chatroom_workspaces'> }
) {
  return await t.run((ctx) =>
    startAgentFromCurrentWorkspaceConfig(ctx, {
      chatroomId: setup.chatroomId,
      role,
      requestedBy: setup.userId,
      ...(options?.workspaceId ? { workspaceId: options.workspaceId } : {}),
    })
  );
}

describe('startAgentFromCurrentWorkspaceConfig', () => {
  test('skips an empty role before reading team state', async () => {
    const setup = await setupChatroom('empty-role');

    await expect(startFromCurrentConfig(setup, '   ')).resolves.toEqual({
      status: 'skipped',
      role: '',
      reason: 'Role is required',
    });
  });

  test('skips when the chatroom has no active team structure', async () => {
    const setup = await setupChatroom('no-team');
    await t.run(async (ctx) => {
      const active = await ctx.db
        .query('chatroom_activeTeamStructures')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', setup.chatroomId))
        .first();
      if (active) await ctx.db.delete('chatroom_activeTeamStructures', active._id);
    });

    await expect(startFromCurrentConfig(setup, 'builder')).resolves.toEqual({
      status: 'skipped',
      role: 'builder',
      reason: 'No active team structure',
    });
  });

  test('skips a role that is not part of the resolved team', async () => {
    const setup = await setupChatroom('not-in-team');

    await expect(startFromCurrentConfig(setup, 'unknown-role')).resolves.toEqual({
      status: 'skipped',
      role: 'unknown-role',
      reason: 'Role is not part of the active team',
    });
  });

  test('skips a team role that has no saved launch configuration', async () => {
    const setup = await setupChatroom('no-config');

    await expect(startFromCurrentConfig(setup, 'builder')).resolves.toEqual({
      status: 'skipped',
      role: 'builder',
      reason: 'No saved launch configuration',
    });
  });

  test('starts a builtin role present in the resolved team', async () => {
    const setup = await setupChatroom('builtin');
    await saveLaunchConfig(setup, 'builder');

    await expect(startFromCurrentConfig(setup, 'builder')).resolves.toEqual({
      status: 'started',
      role: 'builder',
      machineId: setup.machineId,
    });
  });

  test('starts an enabled custom agent from its saved launch configuration', async () => {
    const setup = await setupChatroom('custom');
    await t.mutation(api.customAgents.syncDefinitions, {
      sessionId: setup.sessionId,
      machineId: setup.machineId,
      scope: 'workspace',
      workingDir: WORKING_DIR,
      contentHash: 'alpha-1',
      agents: [makeAgent('alpha', 'a1')],
      issues: [],
    });
    await saveLaunchConfig(setup, 'alpha');

    await expect(startFromCurrentConfig(setup, 'alpha')).resolves.toEqual({
      status: 'started',
      role: 'alpha',
      machineId: setup.machineId,
    });
  });

  test('resolves membership from persisted roles for a legacy team structure id', async () => {
    const setup = await setupChatroom('legacy-squad');
    await t.run(async (ctx) => {
      const active = await ctx.db
        .query('chatroom_activeTeamStructures')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', setup.chatroomId))
        .first();
      await ctx.db.patch('chatroom_activeTeamStructures', active!._id, {
        teamStructureId: 'legacy-squad',
      });
      await ctx.db.patch('chatroom_rooms', setup.chatroomId, {
        teamRoles: ['planner', 'builder'],
      });
    });
    await saveLaunchConfig(setup, 'builder');

    await expect(startFromCurrentConfig(setup, 'builder')).resolves.toEqual({
      status: 'started',
      role: 'builder',
      machineId: setup.machineId,
    });
  });
});
