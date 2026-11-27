/**
 * agents.applyConfig / agents.getAgentModelOptions — the single decision point for saving a role's
 * harness and model: unchanged (no write), saved (not running), restarted (changed and running).
 *
 * Driven through public functions. `t.run` is used only to seed status rows, the custom-agent launch
 * request, an unreachable-through-public-mutations workspace for the ownership case, and to read
 * tables.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { registerWorkspace as registerWorkspaceUseCase } from '../src/domain/usecase/workspace/register-workspace';

type ChatroomId = Id<'chatroom_rooms'>;
type WorkspaceId = Id<'chatroom_workspaces'>;
type Status = 'offline' | 'starting' | 'waiting' | 'working' | 'stopping' | 'error';

interface Seeded {
  sessionId: SessionId;
  chatroomId: ChatroomId;
  workspaceId: WorkspaceId;
  machineId: string;
}

interface RestartCommand {
  type: string;
  requestId?: string;
  chatroomId?: string;
  role?: string;
  agentHarness?: string;
  model?: string;
  workingDir?: string;
  correlationId?: string;
  wantResume?: boolean;
}

const AVAILABLE_MODELS = {
  'opencode-sdk': ['openai/gpt-4', 'anthropic/claude'],
  // Empty catalog: any model id is accepted for this harness.
  'codex-sdk': [] as string[],
};

async function login(sessionId: SessionId): Promise<void> {
  const loginResult = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(loginResult.success).toBe(true);
}

/** Registers a machine, creates a trio chatroom and its primary workspace. */
async function seedTrio(
  sessionId: SessionId,
  machineId: string
): Promise<{ chatroomId: ChatroomId; workspaceId: WorkspaceId }> {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: `${machineId}-host`,
    os: 'linux',
    availableHarnesses: ['opencode-sdk', 'codex-sdk'],
    availableModels: AVAILABLE_MODELS,
  });
  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId,
    teamStructureId: 'trio@1',
  });
  const workspaceId = await t.mutation(api.workspaces.registerWorkspace, {
    sessionId,
    chatroomId,
    machineId,
    workingDir: '/work/repo',
    hostname: 'test-host',
    registeredBy: 'coordinator',
  });
  await t.mutation(api.workspaces.setPrimaryWorkspaceForChatroom, {
    sessionId,
    chatroomId,
    workspaceId,
  });
  return { chatroomId, workspaceId };
}

/** A uniquely-named trio chatroom per test: shared convex-test DB, so ids must not collide. */
async function setup(tag: string): Promise<Seeded> {
  const sessionId = `session-${tag}` as SessionId;
  const machineId = `machine-${tag}`;
  await login(sessionId);
  const { chatroomId, workspaceId } = await seedTrio(sessionId, machineId);
  return { sessionId, chatroomId, workspaceId, machineId };
}

async function saveAs(
  seeded: Seeded,
  overrides: Partial<{
    workspaceId: WorkspaceId;
    role: string;
    agentHarness: 'opencode-sdk' | 'codex-sdk';
    model: string;
    workingDir: string;
  }> = {}
): Promise<void> {
  await t.mutation(api.agents.saveConfig, {
    sessionId: seeded.sessionId,
    chatroomId: seeded.chatroomId,
    workspaceId: overrides.workspaceId ?? seeded.workspaceId,
    role: overrides.role ?? 'builder',
    machineId: seeded.machineId,
    agentHarness: overrides.agentHarness ?? 'opencode-sdk',
    model: overrides.model ?? 'openai/gpt-4',
    workingDir: overrides.workingDir ?? '/work/repo',
  });
}

async function setStatus(
  seeded: Seeded,
  role: string,
  status: Status,
  workspaceId: WorkspaceId = seeded.workspaceId
): Promise<void> {
  await t.run(async (ctx) =>
    ctx.db.insert('chatroom_agentRoleStatusReadModel', {
      chatroomId: seeded.chatroomId,
      workspaceId,
      role,
      roleKind: 'persistent',
      status,
      machineId: seeded.machineId,
      workingDir: '/work/repo',
      projectedAt: Date.now(),
    })
  );
}

async function applyConfig(
  seeded: Seeded,
  args: {
    role?: string;
    agentHarness: string;
    model: string;
    workspaceId?: WorkspaceId | undefined;
  }
) {
  return t.mutation(api.agents.applyConfig, {
    sessionId: seeded.sessionId,
    chatroomId: seeded.chatroomId,
    role: args.role ?? 'builder',
    agentHarness: args.agentHarness,
    model: args.model,
    ...(args.workspaceId !== undefined ? { workspaceId: args.workspaceId } : {}),
  });
}

/** `agent.restart` commands queued for one test's machine (the shared DB holds other tests' rows). */
async function restartCommands(seeded: Seeded): Promise<RestartCommand[]> {
  const rows = await t.run(async (ctx) => ctx.db.query('chatroom_machineCommandInbox').collect());
  return rows
    .filter((row) => row.machineId === seeded.machineId)
    .map((row) => row.command as unknown as RestartCommand)
    .filter((command) => command.type === 'agent.restart');
}

/** Config-inbox rows for one test's machine, so counts are independent of other tests. */
async function configInboxCount(seeded: Seeded): Promise<number> {
  const rows = await t.run(async (ctx) =>
    ctx.db.query('chatroomWorkspaceAgentConfigInbox').collect()
  );
  return rows.filter((row) => row.machineId === seeded.machineId).length;
}

async function launchRequestCount(chatroomId: ChatroomId): Promise<number> {
  return t.run(
    async (ctx) =>
      (
        await ctx.db
          .query('chatroom_agentLastSentLaunchRequests')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
          .collect()
      ).length
  );
}

async function storedConfig(
  seeded: Seeded,
  role = 'builder'
): Promise<{ agentHarness: string; model: string } | undefined> {
  const requests = await t.query(api.agents.listLastSentLaunchRequests, {
    sessionId: seeded.sessionId,
    chatroomId: seeded.chatroomId,
  });
  const row = requests.find((request) => request.role.toLowerCase() === role.toLowerCase());
  return row ? { agentHarness: row.agentHarness, model: row.model } : undefined;
}

async function storedLaunchRequestRowId(
  seeded: Seeded,
  role = 'builder'
): Promise<Id<'chatroom_agentLastSentLaunchRequests'>> {
  return t.run(async (ctx) => {
    const row = await ctx.db
      .query('chatroom_agentLastSentLaunchRequests')
      .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', seeded.chatroomId).eq('role', role))
      .first();
    if (!row) throw new Error('launch request not seeded');
    return row._id;
  });
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ data: { code } });
}

describe('agents.applyConfig', () => {
  test('unchanged harness and model performs no write and no restart', async () => {
    const seeded = await setup('unchanged');
    await saveAs(seeded, { model: 'openai/gpt-4' });
    await setStatus(seeded, 'builder', 'working');
    const launchId = await storedLaunchRequestRowId(seeded);
    const requestedAtBefore = await t.run(
      async (ctx) =>
        (await ctx.db.get('chatroom_agentLastSentLaunchRequests', launchId))!.requestedAt
    );
    const restartsBefore = (await restartCommands(seeded)).length;
    const inboxBefore = await configInboxCount(seeded);

    const result = await applyConfig(seeded, {
      agentHarness: 'opencode-sdk',
      model: '  openai/gpt-4 ',
    });

    expect(result.outcome).toBe('unchanged');
    expect(result.running).toBe(true);
    expect(result.previous).toEqual({ agentHarness: 'opencode-sdk', model: 'openai/gpt-4' });
    expect(await restartCommands(seeded)).toHaveLength(restartsBefore);
    expect(await configInboxCount(seeded)).toBe(inboxBefore);
    const launchAfter = await t.run(async (ctx) =>
      ctx.db.get('chatroom_agentLastSentLaunchRequests', launchId)
    );
    expect(launchAfter?._id).toBe(launchId);
    expect(launchAfter?.requestedAt).toBe(requestedAtBefore);
  });

  test.each(['working', 'waiting', 'starting', 'stopping'] as const)(
    'changed config on a %s agent restarts exactly once',
    async (status) => {
      const seeded = await setup(`restart-${status}`);
      await saveAs(seeded, { agentHarness: 'opencode-sdk', model: 'openai/gpt-4' });
      await setStatus(seeded, 'builder', status);

      const result = await applyConfig(seeded, {
        agentHarness: 'codex-sdk',
        model: 'gpt-5.6-luna[reasoning=low]',
      });

      expect(result.outcome).toBe('restarted');
      expect(result.running).toBe(true);
      expect(result.correlationId).toBeDefined();

      const restarts = await restartCommands(seeded);
      expect(restarts).toHaveLength(1);
      expect(restarts[0]).toMatchObject({
        type: 'agent.restart',
        agentHarness: 'codex-sdk',
        model: 'gpt-5.6-luna[reasoning=low]',
        role: 'builder',
        workingDir: '/work/repo',
        correlationId: result.correlationId,
      });
      expect(await storedConfig(seeded)).toEqual({
        agentHarness: 'codex-sdk',
        model: 'gpt-5.6-luna[reasoning=low]',
      });
    }
  );

  test.each(['offline', 'error', 'none'] as const)(
    'changed config on a %s agent saves only',
    async (status) => {
      const seeded = await setup(`saved-${status}`);
      await saveAs(seeded, { agentHarness: 'opencode-sdk', model: 'openai/gpt-4' });
      if (status !== 'none') await setStatus(seeded, 'builder', status);
      const restartsBefore = (await restartCommands(seeded)).length;

      const result = await applyConfig(seeded, {
        agentHarness: 'codex-sdk',
        model: 'gpt-5.6-luna[reasoning=low]',
      });

      expect(result.outcome).toBe('saved');
      expect(result.running).toBe(false);
      expect(await restartCommands(seeded)).toHaveLength(restartsBefore);
      expect(await storedConfig(seeded)).toEqual({
        agentHarness: 'codex-sdk',
        model: 'gpt-5.6-luna[reasoning=low]',
      });
    }
  );

  test('no previous config and not running saves with previous null', async () => {
    const seeded = await setup('first-save');

    const result = await applyConfig(seeded, {
      agentHarness: 'codex-sdk',
      model: 'gpt-5.6-luna[reasoning=low]',
    });

    expect(result.outcome).toBe('saved');
    expect(result.running).toBe(false);
    expect(result.previous).toBeNull();
    expect(await restartCommands(seeded)).toHaveLength(0);
  });

  test('no previous config on a running agent saves without restarting', async () => {
    const seeded = await setup('first-save-running');
    await setStatus(seeded, 'builder', 'working');

    const result = await applyConfig(seeded, {
      agentHarness: 'codex-sdk',
      model: 'gpt-5.6-luna[reasoning=low]',
    });

    expect(result.outcome).toBe('saved');
    expect(result.running).toBe(true);
    expect(result.previous).toBeNull();
    expect(await restartCommands(seeded)).toHaveLength(0);
  });

  test('is idempotent: re-applying the restarted config is a no-op', async () => {
    const seeded = await setup('idempotent');
    await saveAs(seeded, { agentHarness: 'opencode-sdk', model: 'openai/gpt-4' });
    await setStatus(seeded, 'builder', 'working');

    const first = await applyConfig(seeded, {
      agentHarness: 'codex-sdk',
      model: 'gpt-5.6-luna[reasoning=low]',
    });
    expect(first.outcome).toBe('restarted');

    const second = await applyConfig(seeded, {
      agentHarness: 'codex-sdk',
      model: 'gpt-5.6-luna[reasoning=low]',
    });
    expect(second.outcome).toBe('unchanged');
    expect(await restartCommands(seeded)).toHaveLength(1);
  });

  test('two different changes on a running agent queue two restarts', async () => {
    const seeded = await setup('two-changes');
    await saveAs(seeded, { agentHarness: 'opencode-sdk', model: 'openai/gpt-4' });
    await setStatus(seeded, 'builder', 'working');

    const first = await applyConfig(seeded, {
      agentHarness: 'opencode-sdk',
      model: 'anthropic/claude',
    });
    const second = await applyConfig(seeded, {
      agentHarness: 'opencode-sdk',
      model: 'openai/gpt-4',
    });

    expect(first.outcome).toBe('restarted');
    expect(second.outcome).toBe('restarted');
    expect((await restartCommands(seeded)).map((command) => command.model)).toEqual([
      'anthropic/claude',
      'openai/gpt-4',
    ]);
  });

  test('rejects a harness that is not on the machine', async () => {
    const seeded = await setup('bad-harness');
    await saveAs(seeded);
    const launchBefore = await launchRequestCount(seeded.chatroomId);
    const restartsBefore = (await restartCommands(seeded)).length;

    await expectCode(
      applyConfig(seeded, { agentHarness: 'pi-sdk', model: 'anything' }),
      'AGENT_CONFIG_HARNESS_UNAVAILABLE'
    );

    expect(await launchRequestCount(seeded.chatroomId)).toBe(launchBefore);
    expect(await restartCommands(seeded)).toHaveLength(restartsBefore);
  });

  test('rejects a model outside a non-empty catalog but accepts any model for an empty catalog', async () => {
    const seeded = await setup('model-catalog');

    await expectCode(
      applyConfig(seeded, { agentHarness: 'opencode-sdk', model: 'openai/unknown' }),
      'AGENT_CONFIG_MODEL_UNAVAILABLE'
    );
    expect(await storedConfig(seeded)).toBeUndefined();

    const result = await applyConfig(seeded, {
      agentHarness: 'codex-sdk',
      model: 'anything-goes',
    });
    expect(result.outcome).toBe('saved');
  });

  test.each(['nobody', 'user'] as const)(
    'rejects role %s that is not a configurable team role',
    async (role) => {
      const seeded = await setup(`bad-role-${role}`);
      await expectCode(
        applyConfig(seeded, { role, agentHarness: 'codex-sdk', model: 'gpt-5.6-luna' }),
        'AGENT_CONFIG_ROLE_NOT_IN_TEAM'
      );
      expect(await storedConfig(seeded, role)).toBeUndefined();
    }
  );

  test('rejects a custom agent config with AGENT_CONFIG_NOT_REMOTE and writes nothing', async () => {
    const seeded = await setup('custom-agent');
    const launchBefore = await launchRequestCount(seeded.chatroomId);

    await t.run(async (ctx) => {
      const chatroom = await ctx.db.get('chatroom_rooms', seeded.chatroomId);
      if (!chatroom?.ownerId) throw new Error('chatroom owner missing');
      await ctx.db.insert('chatroom_agentLastSentLaunchRequests', {
        requestKey: `${seeded.chatroomId}:trio@1:${seeded.workspaceId}:builder`,
        requestId: 'custom-request',
        commandId: 'custom-command',
        chatroomId: seeded.chatroomId,
        teamStructureId: 'trio@1',
        role: 'builder',
        agentType: 'custom',
        machineId: seeded.machineId,
        workspaceId: seeded.workspaceId,
        agentHarness: 'opencode-sdk',
        model: 'openai/gpt-4',
        workingDir: '/work/repo',
        reason: 'user.config',
        wantResume: false,
        requestedBy: chatroom.ownerId,
        requestedAt: Date.now(),
      });
    });

    await expectCode(
      applyConfig(seeded, { agentHarness: 'codex-sdk', model: 'gpt-5.6-luna' }),
      'AGENT_CONFIG_NOT_REMOTE'
    );

    expect(await launchRequestCount(seeded.chatroomId)).toBe(launchBefore + 1);
    expect((await restartCommands(seeded)).length).toBe(0);
  });

  test('rejects when the chatroom has no active workspace', async () => {
    const sessionId = 'session-no-workspace' as SessionId;
    const machineId = 'machine-no-workspace';
    await login(sessionId);
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'host',
      os: 'linux',
      availableHarnesses: ['opencode-sdk', 'codex-sdk'],
      availableModels: AVAILABLE_MODELS,
    });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamStructureId: 'trio@1',
    });

    await expectCode(
      t.mutation(api.agents.applyConfig, {
        sessionId,
        chatroomId,
        role: 'builder',
        agentHarness: 'codex-sdk',
        model: 'gpt-5.6-luna',
      }),
      'AGENT_CONFIG_NO_WORKSPACE'
    );
  });

  test('workspace precedence: explicit → newest config → primary', async () => {
    const seeded = await setup('workspace-precedence');
    const secondWorkspaceId = await t.run((ctx) =>
      registerWorkspaceUseCase(ctx, {
        chatroomId: seeded.chatroomId,
        machineId: seeded.machineId,
        workingDir: '/work/other',
        hostname: 'test-host',
        registeredBy: 'coordinator',
      })
    );
    await saveAs(seeded, {
      workspaceId: secondWorkspaceId,
      workingDir: '/work/other',
    });

    const fromPrevious = await applyConfig(seeded, {
      agentHarness: 'opencode-sdk',
      model: 'openai/gpt-4',
    });
    expect(fromPrevious.effective.workspaceId).toBe(secondWorkspaceId);

    const explicit = await applyConfig(seeded, {
      workspaceId: seeded.workspaceId,
      agentHarness: 'codex-sdk',
      model: 'gpt-5.6-luna',
    });
    expect(explicit.effective.workspaceId).toBe(seeded.workspaceId);

    const otherChatroomId = await t.mutation(api.chatrooms.create, {
      sessionId: seeded.sessionId,
      teamStructureId: 'trio@1',
    });
    const foreignWorkspaceId = await t.mutation(api.workspaces.registerWorkspace, {
      sessionId: seeded.sessionId,
      chatroomId: otherChatroomId,
      machineId: seeded.machineId,
      workingDir: '/work/foreign',
      hostname: 'test-host',
      registeredBy: 'coordinator',
    });

    await expectCode(
      applyConfig(seeded, {
        workspaceId: foreignWorkspaceId,
        agentHarness: 'codex-sdk',
        model: 'gpt-5.6-luna',
      }),
      'AGENT_CONFIG_NO_WORKSPACE'
    );
  });

  test('rejects a caller who does not own the chatroom, without writing', async () => {
    const seeded = await setup('auth-chatroom');
    const otherSession = 'session-auth-chatroom-other' as SessionId;
    await login(otherSession);

    await expectCode(
      t.mutation(api.agents.applyConfig, {
        sessionId: otherSession,
        chatroomId: seeded.chatroomId,
        role: 'builder',
        agentHarness: 'codex-sdk',
        model: 'gpt-5.6-luna',
      }),
      'ACCESS_DENIED'
    );
    expect(await launchRequestCount(seeded.chatroomId)).toBe(0);
  });

  test('rejects a caller who does not own the machine, without writing', async () => {
    const machineOwner = 'session-auth-machine-owner' as SessionId;
    const caller = 'session-auth-machine-caller' as SessionId;
    await login(machineOwner);
    await login(caller);

    const machineId = 'machine-auth-machine';
    await t.mutation(api.machines.register, {
      sessionId: machineOwner,
      machineId,
      hostname: 'owner-host',
      os: 'linux',
      availableHarnesses: ['opencode-sdk', 'codex-sdk'],
      availableModels: AVAILABLE_MODELS,
    });
    const chatroomId = await t.mutation(api.chatrooms.create, {
      sessionId: caller,
      teamStructureId: 'trio@1',
    });
    // A workspace pointing at someone else's machine is unreachable through public mutations
    // (registerWorkspace requires machine ownership), so seed it directly.
    const foreignWorkspaceId = await t.run(async (ctx) =>
      ctx.db.insert('chatroom_workspaces', {
        chatroomId,
        machineId,
        workingDir: '/work/foreign',
        hostname: 'owner-host',
        registeredAt: Date.now(),
        registeredBy: 'coordinator',
      })
    );
    await t.mutation(api.workspaces.setPrimaryWorkspaceForChatroom, {
      sessionId: caller,
      chatroomId,
      workspaceId: foreignWorkspaceId,
    });

    await expectCode(
      t.mutation(api.agents.applyConfig, {
        sessionId: caller,
        chatroomId,
        role: 'builder',
        agentHarness: 'codex-sdk',
        model: 'gpt-5.6-luna',
      }),
      'NOT_AUTHORIZED_MACHINE'
    );
    expect(await launchRequestCount(chatroomId)).toBe(0);
  });
});

describe('agents.getAgentModelOptions', () => {
  test('lists available harnesses, their models and the current harness', async () => {
    const seeded = await setup('model-options');
    await saveAs(seeded, { agentHarness: 'opencode-sdk', model: 'openai/gpt-4' });

    const options = await t.query(api.agents.getAgentModelOptions, {
      sessionId: seeded.sessionId,
      chatroomId: seeded.chatroomId,
      teamId: 'trio',
      role: 'builder',
    });

    expect(options.role).toBe('builder');
    expect(options.teamId).toBe('trio');
    expect(options.machineId).toBe(seeded.machineId);
    expect(options.current).toEqual({ agentHarness: 'opencode-sdk', model: 'openai/gpt-4' });
    expect(options.harnesses).toEqual([
      { harness: 'opencode-sdk', models: ['openai/gpt-4', 'anthropic/claude'], isCurrent: true },
      { harness: 'codex-sdk', models: [], isCurrent: false },
    ]);
  });

  test('filters by harness and rejects an unavailable one', async () => {
    const seeded = await setup('model-options-filter');
    await saveAs(seeded);

    const codexOnly = await t.query(api.agents.getAgentModelOptions, {
      sessionId: seeded.sessionId,
      chatroomId: seeded.chatroomId,
      teamId: 'trio',
      role: 'builder',
      harness: 'codex-sdk',
    });
    expect(codexOnly.harnesses.map((entry) => entry.harness)).toEqual(['codex-sdk']);

    await expectCode(
      t.query(api.agents.getAgentModelOptions, {
        sessionId: seeded.sessionId,
        chatroomId: seeded.chatroomId,
        teamId: 'trio',
        role: 'builder',
        harness: 'pi-sdk',
      }),
      'AGENT_CONFIG_HARNESS_UNAVAILABLE'
    );
  });

  test('accepts the canonical team id or its alias and rejects another team', async () => {
    const seeded = await setup('model-options-team');
    await saveAs(seeded);
    const base = {
      sessionId: seeded.sessionId,
      chatroomId: seeded.chatroomId,
      role: 'builder',
    };

    const canonical = await t.query(api.agents.getAgentModelOptions, { ...base, teamId: 'trio' });
    expect(canonical.teamId).toBe('trio');
    const alias = await t.query(api.agents.getAgentModelOptions, { ...base, teamId: 'trio@1' });
    expect(alias.teamId).toBe('trio');

    await expectCode(
      t.query(api.agents.getAgentModelOptions, { ...base, teamId: 'solo' }),
      'AGENT_CONFIG_TEAM_MISMATCH'
    );
  });

  test('falls back to the deprecated capability-row catalog', async () => {
    const seeded = await setup('model-options-fallback');
    await saveAs(seeded);
    await t.run(async (ctx) => {
      const models = await ctx.db
        .query('chatroom_machineAvailableModels')
        .withIndex('by_machineId', (q) => q.eq('machineId', seeded.machineId))
        .first();
      if (models) await ctx.db.delete('chatroom_machineAvailableModels', models._id);
      const capabilities = await ctx.db
        .query('chatroom_machineCapabilities')
        .withIndex('by_machineId', (q) => q.eq('machineId', seeded.machineId))
        .first();
      if (!capabilities) throw new Error('capabilities missing');
      await ctx.db.patch('chatroom_machineCapabilities', capabilities._id, {
        availableModels: { 'opencode-sdk': ['legacy/model'] },
      });
    });

    const options = await t.query(api.agents.getAgentModelOptions, {
      sessionId: seeded.sessionId,
      chatroomId: seeded.chatroomId,
      teamId: 'trio',
      role: 'builder',
    });
    const opencode = options.harnesses.find((entry) => entry.harness === 'opencode-sdk');
    expect(opencode?.models).toEqual(['legacy/model']);
  });

  test('rejects a caller who does not own the chatroom', async () => {
    const seeded = await setup('model-options-auth');
    const otherSession = 'session-model-options-auth-other' as SessionId;
    await login(otherSession);

    await expectCode(
      t.query(api.agents.getAgentModelOptions, {
        sessionId: otherSession,
        chatroomId: seeded.chatroomId,
        teamId: 'trio',
        role: 'builder',
      }),
      'ACCESS_DENIED'
    );
  });
});
