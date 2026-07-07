/**
 * Integration tests for registerWorkspace path validation.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

async function createSession(id: string) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: id as SessionId });
  expect(login.success).toBe(true);
  return { sessionId: id as SessionId, userId: login.userId as Id<'users'> };
}

async function createChatroom(sessionId: SessionId): Promise<Id<'chatroom_rooms'>> {
  return t.mutation(api.chatrooms.create, {
    sessionId,
    teamId: 'duo',
    teamName: 'Test Team',
    teamRoles: ['planner', 'builder'],
    teamEntryPoint: 'planner',
  });
}

async function registerMachine(sessionId: SessionId, machineId: string) {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'linux',
    availableHarnesses: ['opencode'],
  });
}

describe('registerWorkspace path validation', () => {
  test('rejects relative working directory paths', async () => {
    const { sessionId } = await createSession('register-ws-invalid-path');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'machine-invalid-path';
    await registerMachine(sessionId, machineId);

    await expect(
      t.mutation(api.workspaces.registerWorkspace, {
        sessionId,
        chatroomId,
        machineId,
        workingDir: 'relative/path',
        hostname: 'test-host',
        registeredBy: 'user',
      })
    ).rejects.toThrow(/absolute path/i);
  });

  test('accepts valid absolute working directory paths', async () => {
    const { sessionId } = await createSession('register-ws-valid-path');
    const chatroomId = await createChatroom(sessionId);
    const machineId = 'machine-valid-path';
    await registerMachine(sessionId, machineId);

    const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/tmp/valid-workspace',
      hostname: 'test-host',
      registeredBy: 'user',
    });

    expect(workspaceId).toBeDefined();
  });
});
