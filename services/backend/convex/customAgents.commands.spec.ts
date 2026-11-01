/**
 * Command contract for custom agents: disable and refresh enqueue machine
 * commands only. The daemon is the only writer of custom-agent rows, so these
 * mutations must never change one.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { MACHINE_COMMAND_TTL_MS } from '../src/domain/entities/machine-command';

const FIXED_NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

type TestAgent = {
  name: string;
  description: string;
  systemPrompt: string;
  contentHash: string;
  disabled: boolean;
};

function makeAgent(name: string, disabled = false): TestAgent {
  return {
    name,
    description: `${name} role.`,
    systemPrompt: `You are ${name}.`,
    contentHash: `${name}-hash`,
    disabled,
  };
}

interface Fixture {
  sessionId: SessionId;
  machineId: string;
  workingDir: string;
  chatroomId: Id<'chatroom_rooms'>;
}

async function setup(suffix: string, workingDir = '/test/workspace'): Promise<Fixture> {
  const sessionId = `custom-agent-commands-${suffix}` as SessionId;
  const machineId = `custom-agent-commands-machine-${suffix}`;

  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode'],
  });
  const { chatroomId } = await t.mutation(api.chatrooms.createWithWorkspace, {
    sessionId,
    teamStructureId: 'duo',
    machineId,
    workingDir,
  });
  return { sessionId, machineId, workingDir, chatroomId };
}

async function syncAgent(fixture: Fixture, agent: TestAgent): Promise<void> {
  await t.mutation(api.customAgents.syncDefinitions, {
    sessionId: fixture.sessionId,
    machineId: fixture.machineId,
    scope: 'workspace',
    workingDir: fixture.workingDir,
    contentHash: 'workspace-hash',
    agents: [agent],
    issues: [],
  });
}

interface InboxCommand {
  machineId: string;
  status: string;
  deadline: number;
  command: { type: string; name?: string; disabled?: boolean };
}

async function readPendingCommands(machineId: string): Promise<InboxCommand[]> {
  return await t.run(async (ctx) =>
    ctx.db
      .query('chatroom_machineCommandInbox')
      .withIndex('by_machine_status_deadline', (q) =>
        q.eq('machineId', machineId).eq('status', 'pending')
      )
      .collect()
  );
}

async function readCustomAgentCommands(machineId: string): Promise<InboxCommand[]> {
  return (await readPendingCommands(machineId)).filter((row) =>
    row.command.type.startsWith('daemon.customAgents')
  );
}

async function readAgentRow(
  fixture: Fixture,
  name: string
): Promise<{ disabled: boolean; updatedAt: number } | null> {
  return await t.run(async (ctx) =>
    ctx.db
      .query('chatroom_customAgents')
      .withIndex('by_machine_scope_workingDir_name', (q) =>
        q
          .eq('machineId', fixture.machineId)
          .eq('scope', 'workspace')
          .eq('workingDir', fixture.workingDir)
          .eq('name', name)
      )
      .first()
  );
}

describe('customAgents.setDisabled', () => {
  test('enqueues one command for the workspace machine and leaves the row alone', async () => {
    const fixture = await setup('set');
    await syncAgent(fixture, makeAgent('alpha'));
    const before = await readAgentRow(fixture, 'alpha');
    expect(before).not.toBeNull();

    const result = await t.mutation(api.customAgents.setDisabled, {
      sessionId: fixture.sessionId,
      chatroomId: fixture.chatroomId,
      name: 'alpha',
      disabled: true,
    });

    expect(result).toEqual({ queued: true });
    const commands = await readCustomAgentCommands(fixture.machineId);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.machineId).toBe(fixture.machineId);
    expect(commands[0]?.command).toEqual({
      type: 'daemon.customAgentsSetDisabled',
      name: 'alpha',
      disabled: true,
    });
    expect(commands[0]?.deadline).toBe(
      FIXED_NOW + MACHINE_COMMAND_TTL_MS['daemon.customAgentsSetDisabled']
    );

    const after = await readAgentRow(fixture, 'alpha');
    expect(after?.disabled).toBe(before?.disabled);
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  test('repeating the same absolute value enqueues an identical command', async () => {
    const fixture = await setup('repeat');
    await syncAgent(fixture, makeAgent('alpha'));
    const call = () =>
      t.mutation(api.customAgents.setDisabled, {
        sessionId: fixture.sessionId,
        chatroomId: fixture.chatroomId,
        name: 'alpha',
        disabled: true,
      });

    await expect(call()).resolves.toEqual({ queued: true });
    await expect(call()).resolves.toEqual({ queued: true });

    const commands = await readCustomAgentCommands(fixture.machineId);
    expect(commands).toHaveLength(2);
    expect(commands[0]?.command).toEqual(commands[1]?.command);
  });

  test('rejects an unknown agent name', async () => {
    const fixture = await setup('unknown');
    await syncAgent(fixture, makeAgent('alpha'));

    await expect(
      t.mutation(api.customAgents.setDisabled, {
        sessionId: fixture.sessionId,
        chatroomId: fixture.chatroomId,
        name: 'nobody',
        disabled: true,
      })
    ).rejects.toMatchObject({ data: { code: 'CUSTOM_AGENT_NOT_FOUND' } });

    expect(await readCustomAgentCommands(fixture.machineId)).toHaveLength(0);
  });

  test('rejects a caller who does not own the chatroom', async () => {
    const fixture = await setup('non-member');
    await syncAgent(fixture, makeAgent('alpha'));

    const otherSession = 'custom-agent-commands-other-session' as SessionId;
    await t.mutation(api.auth.loginAnon, { sessionId: otherSession });

    await expect(
      t.mutation(api.customAgents.setDisabled, {
        sessionId: otherSession,
        chatroomId: fixture.chatroomId,
        name: 'alpha',
        disabled: true,
      })
    ).rejects.toMatchObject({ data: { code: 'ACCESS_DENIED' } });

    expect(await readCustomAgentCommands(fixture.machineId)).toHaveLength(0);
  });

  test('rejects a chatroom owner who does not own the workspace machine', async () => {
    // The other user's machine owns the definition the intruder chatroom resolves.
    const other = await setup('other-owner', '/test/other-owner');
    await syncAgent(other, makeAgent('alpha'));

    const intruder = await setup('intruder', '/test/intruder');
    await t.run(async (ctx) => {
      const workspace = await ctx.db
        .query('chatroom_workspaces')
        .withIndex('by_chatroom', (q) => q.eq('chatroomId', intruder.chatroomId))
        .first();
      if (workspace === null) throw new Error('workspace fixture is missing');
      await ctx.db.patch('chatroom_workspaces', workspace._id, {
        machineId: other.machineId,
        workingDir: other.workingDir,
      });
    });

    await expect(
      t.mutation(api.customAgents.setDisabled, {
        sessionId: intruder.sessionId,
        chatroomId: intruder.chatroomId,
        name: 'alpha',
        disabled: true,
      })
    ).rejects.toMatchObject({ data: { code: 'NOT_AUTHORIZED_MACHINE' } });

    expect(await readCustomAgentCommands(other.machineId)).toHaveLength(0);
  });
});

describe('customAgents.requestRefresh', () => {
  test('enqueues one refresh command for the workspace machine', async () => {
    const fixture = await setup('refresh');

    const result = await t.mutation(api.customAgents.requestRefresh, {
      sessionId: fixture.sessionId,
      chatroomId: fixture.chatroomId,
    });

    expect(result).toEqual({ queued: true });
    const commands = await readCustomAgentCommands(fixture.machineId);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.machineId).toBe(fixture.machineId);
    expect(commands[0]?.command).toEqual({ type: 'daemon.customAgentsRefresh' });
    expect(commands[0]?.deadline).toBe(
      FIXED_NOW + MACHINE_COMMAND_TTL_MS['daemon.customAgentsRefresh']
    );
  });

  test('rejects a chatroom with no primary workspace', async () => {
    const sessionId = 'custom-agent-commands-no-workspace' as SessionId;
    await t.mutation(api.auth.loginAnon, { sessionId });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamStructureId: 'duo',
    });

    await expect(
      t.mutation(api.customAgents.requestRefresh, { sessionId, chatroomId })
    ).rejects.toMatchObject({ data: { code: 'CUSTOM_AGENT_NO_WORKSPACE' } });
  });
});
