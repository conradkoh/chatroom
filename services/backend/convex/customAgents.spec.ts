import { CUSTOM_AGENT_RULES_VERSION } from '@workspace/shared/domain/custom-agent';
import { getTeamStructure } from '@workspace/shared/domain/team-presets';
import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { PARTICIPANT_EXITED_ACTION } from '../src/domain/entities/participant';
import { projectAgentRoleStatusReadModel } from '../src/domain/usecase/agent/project-agent-role-status-read-model';
import { isEphemeralRoleInChatroom } from '../src/domain/usecase/team/resolve-chatroom-team';

const FIXED_NOW = 1_700_000_000_000;
let clock = FIXED_NOW;

beforeEach(() => {
  clock = FIXED_NOW;
  vi.useFakeTimers();
  vi.setSystemTime(clock);
});

afterEach(() => {
  vi.useRealTimers();
});

function advanceClock(ms: number): void {
  clock += ms;
  vi.setSystemTime(clock);
}

type TestAgent = {
  name: string;
  description: string;
  systemPrompt: string;
  inboundHandoffTemplate?: string;
  returnHandoffTemplate?: string;
  contentHash: string;
  disabled: boolean;
};

function makeAgent(
  name: string,
  contentHash: string,
  overrides: Partial<Omit<TestAgent, 'name' | 'contentHash'>> = {}
): TestAgent {
  return {
    name,
    description: overrides.description ?? `${name} role.`,
    systemPrompt: overrides.systemPrompt ?? `You are ${name}.`,
    contentHash,
    disabled: overrides.disabled ?? false,
    ...(overrides.inboundHandoffTemplate !== undefined
      ? { inboundHandoffTemplate: overrides.inboundHandoffTemplate }
      : {}),
    ...(overrides.returnHandoffTemplate !== undefined
      ? { returnHandoffTemplate: overrides.returnHandoffTemplate }
      : {}),
  };
}

async function setup(suffix: string) {
  const sessionId = `custom-agents-${suffix}` as SessionId;
  const machineId = `custom-agents-machine-${suffix}`;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode'],
  });
  return { sessionId, machineId, workingDir: '/test/workspace' };
}

async function readSource(machineId: string, scope: 'workspace' | 'machine', workingDir?: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query('chatroom_customAgentSources')
      .withIndex('by_machine_scope_workingDir', (q) =>
        q.eq('machineId', machineId).eq('scope', scope).eq('workingDir', workingDir)
      )
      .first()
  );
}

async function readAgents(sourceId: Id<'chatroom_customAgentSources'>) {
  return await t.run(async (ctx) =>
    ctx.db
      .query('chatroom_customAgents')
      .withIndex('by_source', (q) => q.eq('sourceId', sourceId))
      .collect()
  );
}

async function readContents(customAgentId: Id<'chatroom_customAgents'>) {
  return await t.run(async (ctx) =>
    ctx.db
      .query('chatroom_customAgentContents')
      .withIndex('by_customAgent', (q) => q.eq('customAgentId', customAgentId))
      .collect()
  );
}

async function readHandoffTemplates(customAgentId: Id<'chatroom_customAgents'>) {
  return await t.run(async (ctx) =>
    ctx.db
      .query('chatroom_customAgentHandoffTemplates')
      .withIndex('by_customAgent_direction', (q) => q.eq('customAgentId', customAgentId))
      .collect()
  );
}

describe('customAgents.syncDefinitions', () => {
  test('rejects a caller who does not own the machine', async () => {
    const { machineId, workingDir } = await setup('non-owner-machine');
    const otherSessionId = 'custom-agents-other-session' as SessionId;
    await t.mutation(api.auth.loginAnon, { sessionId: otherSessionId });

    await expect(
      t.mutation(api.customAgents.syncDefinitions, {
        sessionId: otherSessionId,
        machineId,
        scope: 'workspace',
        workingDir,
        contentHash: 'hash-1',
        agents: [makeAgent('alpha', 'a1')],
        issues: [],
      })
    ).rejects.toThrow(/NOT_AUTHORIZED_MACHINE/);
  });

  test('treats an identical push as a no-op and leaves updatedAt untouched', async () => {
    const { sessionId, machineId, workingDir } = await setup('noop');
    const agents = [makeAgent('alpha', 'a1')];

    const first = await t.mutation(api.customAgents.syncDefinitions, {
      sessionId,
      machineId,
      scope: 'workspace',
      workingDir,
      contentHash: 'hash-1',
      agents,
      issues: [],
    });
    expect(first).toEqual({ applied: true, rejected: [] });

    const source = await readSource(machineId, 'workspace', workingDir);
    expect(source?.updatedAt).toBe(FIXED_NOW);
    const storedAgents = await readAgents(source!._id);
    expect(storedAgents).toHaveLength(1);
    const agentUpdatedAt = storedAgents[0]!.updatedAt;

    advanceClock(1_000);
    const second = await t.mutation(api.customAgents.syncDefinitions, {
      sessionId,
      machineId,
      scope: 'workspace',
      workingDir,
      contentHash: 'hash-1',
      agents,
      issues: [],
    });
    expect(second).toEqual({ applied: false, rejected: [] });

    const sourceAfter = await readSource(machineId, 'workspace', workingDir);
    expect(sourceAfter?.updatedAt).toBe(FIXED_NOW);
    const agentsAfter = await readAgents(sourceAfter!._id);
    expect(agentsAfter[0]!.updatedAt).toBe(agentUpdatedAt);
  });

  test('inserts, patches, and deletes identity and content rows with the pushed set', async () => {
    const { sessionId, machineId, workingDir } = await setup('diff');
    const sync = (contentHash: string, agents: TestAgent[]) =>
      t.mutation(api.customAgents.syncDefinitions, {
        sessionId,
        machineId,
        scope: 'workspace',
        workingDir,
        contentHash,
        agents,
        issues: [],
      });

    await sync('hash-1', [makeAgent('alpha', 'a1')]);
    const firstSource = await readSource(machineId, 'workspace', workingDir);
    const inserted = await readAgents(firstSource!._id);
    expect(inserted.map(({ name }) => name)).toEqual(['alpha']);
    expect(inserted[0]!.updatedAt).toBe(FIXED_NOW);
    expect(await readContents(inserted[0]!._id)).toEqual([
      expect.objectContaining({ systemPrompt: 'You are alpha.' }),
    ]);

    advanceClock(1_000);
    await sync('hash-2', [
      makeAgent('alpha', 'a2', {
        description: 'Alpha updated.',
        systemPrompt: 'You are alpha, updated.',
        inboundHandoffTemplate: 'inbound',
      }),
      makeAgent('beta', 'b1'),
    ]);

    const secondSource = await readSource(machineId, 'workspace', workingDir);
    expect(secondSource!._id).toBe(firstSource!._id);
    expect(secondSource!.agentCount).toBe(2);
    expect(secondSource!.updatedAt).toBe(FIXED_NOW + 1_000);

    const patched = (await readAgents(secondSource!._id)).find(({ name }) => name === 'alpha')!;
    expect(patched.updatedAt).toBe(FIXED_NOW + 1_000);
    expect(patched.description).toBe('Alpha updated.');
    expect(await readContents(patched._id)).toEqual([
      expect.objectContaining({ systemPrompt: 'You are alpha, updated.' }),
    ]);
    expect(await readContents(patched._id)).toHaveLength(1);
    expect(await readHandoffTemplates(patched._id)).toEqual([
      expect.objectContaining({ direction: 'inbound', body: 'inbound' }),
    ]);

    advanceClock(1_000);
    await sync('hash-3', [makeAgent('beta', 'b1')]);

    const thirdSource = await readSource(machineId, 'workspace', workingDir);
    expect(thirdSource!.agentCount).toBe(1);
    const remaining = await readAgents(thirdSource!._id);
    expect(remaining.map(({ name }) => name)).toEqual(['beta']);
    expect(await readContents(patched._id)).toEqual([]);
    expect(await readHandoffTemplates(patched._id)).toEqual([]);
  });

  test('keeps valid agents while reporting invalid ones as rejections and issues', async () => {
    const { sessionId, machineId, workingDir } = await setup('rejected');

    const result = await t.mutation(api.customAgents.syncDefinitions, {
      sessionId,
      machineId,
      scope: 'workspace',
      workingDir,
      contentHash: 'hash-1',
      agents: [makeAgent('alpha', 'a1'), makeAgent('Bad_Name', 'bad'), makeAgent('planner', 'p1')],
      issues: [],
    });

    expect(result).toEqual({
      applied: true,
      rejected: [
        { name: 'Bad_Name', reason: 'invalid-name' },
        { name: 'planner', reason: 'reserved-name' },
      ],
    });

    const source = await readSource(machineId, 'workspace', workingDir);
    expect(source!.agentCount).toBe(1);
    expect(source!.issues).toEqual(
      expect.arrayContaining([
        { path: 'Bad_Name', reason: 'invalid-name' },
        { path: 'planner', reason: 'reserved-name' },
      ])
    );
    const stored = await readAgents(source!._id);
    expect(stored.map(({ name }) => name)).toEqual(['alpha']);
  });

  test.each([
    ['workspace without workingDir', { scope: 'workspace' as const }],
    ['machine with workingDir', { scope: 'machine' as const, workingDir: '/test/workspace' }],
  ])('rejects an invalid scope: %s', async (_label, scopeInput) => {
    const { sessionId, machineId } = await setup(`scope-${_label.replaceAll(' ', '-')}`);

    await expect(
      t.mutation(api.customAgents.syncDefinitions, {
        sessionId,
        machineId,
        ...scopeInput,
        contentHash: 'hash-1',
        agents: [makeAgent('alpha', 'a1')],
        issues: [],
      })
    ).rejects.toThrow(/INVALID_SCOPE/);
  });

  test('normalizes a trailing slash in workingDir so the workspace resolves', async () => {
    const { sessionId, machineId, workingDir, chatroomId } =
      await setupChatroom('working-dir-normalize');

    const result = await syncWorkspaceAgent(
      sessionId,
      machineId,
      `${workingDir}/`,
      makeAgent('alpha', 'a1')
    );
    expect(result).toEqual({ applied: true, rejected: [] });

    // The row is stored under the canonical path the workspace registered.
    const source = await readSource(machineId, 'workspace', workingDir);
    expect(source).not.toBeNull();
    const rows = await readAgents(source!._id);
    expect(rows.map(({ name }) => name)).toEqual(['alpha']);
    expect(rows[0]!.workingDir).toBe(workingDir);

    const structure = await t.query(api.chatrooms.getTeamStructureForChatroom, {
      sessionId,
      chatroomId,
    });
    expect(structure!.roles.map(({ role }) => role)).toContain('alpha');
  });

  test('rejects a sync whose workingDir is not an absolute path', async () => {
    const { sessionId, machineId } = await setup('invalid-working-dir');

    await expect(
      t.mutation(api.customAgents.syncDefinitions, {
        sessionId,
        machineId,
        scope: 'workspace',
        workingDir: 'relative/workspace',
        contentHash: 'hash-1',
        agents: [makeAgent('alpha', 'a1')],
        issues: [],
      })
    ).rejects.toThrow(/absolute path/);
  });

  test('rejects more than the per-source agent limit', async () => {
    const { sessionId, machineId, workingDir } = await setup('agent-limit');
    const agents = Array.from({ length: 13 }, (_, index) => {
      const name = `agent-${String(index).padStart(2, '0')}`;
      return makeAgent(name, `hash-${name}`);
    });

    await expect(
      t.mutation(api.customAgents.syncDefinitions, {
        sessionId,
        machineId,
        scope: 'workspace',
        workingDir,
        contentHash: 'hash-limit',
        agents,
        issues: [],
      })
    ).rejects.toThrow(/INVALID_SCOPE/);
  });

  test('rejects more than the per-source issue limit', async () => {
    const { sessionId, machineId, workingDir } = await setup('issue-limit');
    const issues = Array.from({ length: 51 }, (_, index) => ({
      path: `file-${index}.md`,
      reason: 'unreadable' as const,
    }));

    await expect(
      t.mutation(api.customAgents.syncDefinitions, {
        sessionId,
        machineId,
        scope: 'workspace',
        workingDir,
        contentHash: 'hash-limit',
        agents: [],
        issues,
      })
    ).rejects.toThrow(/INVALID_SCOPE/);
  });
});

async function setupChatroom(
  suffix: string,
  teamStructureId = 'duo',
  workingDir = '/test/workspace'
) {
  const base = await setup(suffix);
  const { chatroomId } = await t.mutation(api.chatrooms.createWithWorkspace, {
    sessionId: base.sessionId,
    teamStructureId,
    machineId: base.machineId,
    workingDir,
  });
  return { ...base, workingDir, chatroomId };
}

async function syncWorkspaceAgent(
  sessionId: SessionId,
  machineId: string,
  workingDir: string,
  agent: TestAgent,
  contentHash = agent.contentHash
) {
  return t.mutation(api.customAgents.syncDefinitions, {
    sessionId,
    machineId,
    scope: 'workspace',
    workingDir,
    contentHash,
    agents: [agent],
    issues: [],
  });
}

async function disableWorkspaceAgent(
  sessionId: SessionId,
  machineId: string,
  workingDir: string,
  agent: TestAgent
) {
  return t.mutation(api.customAgents.syncDefinitions, {
    sessionId,
    machineId,
    scope: 'workspace',
    workingDir,
    contentHash: `disabled-${agent.contentHash}`,
    agents: [{ ...agent, disabled: true }],
    issues: [],
  });
}

async function seedActiveTask(chatroomId: Id<'chatroom_rooms'>, assignedTo: string) {
  return t.run(async (ctx) =>
    ctx.db.insert('chatroom_tasks', {
      chatroomId,
      createdBy: 'user',
      content: 'Active work',
      status: 'in_progress',
      assignedTo,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
      queuePosition: 0,
    })
  );
}

describe('chatroom team resolution with custom agents', () => {
  test('appends a synced workspace agent as an optional ephemeral role after the builtins', async () => {
    const { sessionId, machineId, workingDir, chatroomId } =
      await setupChatroom('resolve-workspace');
    await syncWorkspaceAgent(sessionId, machineId, workingDir, makeAgent('alpha', 'a1'));

    const structure = await t.query(api.chatrooms.getTeamStructureForChatroom, {
      sessionId,
      chatroomId,
    });
    const base = getTeamStructure({ teamId: 'duo' });

    expect(structure!.teamStructureId).toBe('duo@1');
    expect(structure!.roles.slice(0, base.roles.length)).toEqual(base.roles);
    expect(structure!.roles.slice(base.roles.length)).toEqual([
      { role: 'alpha', lifecycle: 'ephemeral', optional: true },
    ]);
  });

  test('shadows a machine agent with the workspace agent of the same name', async () => {
    const { sessionId, machineId, workingDir, chatroomId } = await setupChatroom('resolve-shadow');
    await syncWorkspaceAgent(
      sessionId,
      machineId,
      workingDir,
      makeAgent('alpha', 'a1', { description: 'Workspace alpha.' })
    );
    await t.mutation(api.customAgents.syncDefinitions, {
      sessionId,
      machineId,
      scope: 'machine',
      contentHash: 'm1',
      agents: [makeAgent('alpha', 'm1', { description: 'Machine alpha.' })],
      issues: [],
    });

    const structure = await t.query(api.chatrooms.getTeamStructureForChatroom, {
      sessionId,
      chatroomId,
    });
    expect(structure!.roles.filter(({ role }) => role === 'alpha')).toHaveLength(1);

    const settings = await t.query(api.customAgents.getTeamRoster, { sessionId, chatroomId });
    expect(settings.roster.find(({ role }) => role === 'alpha')).toMatchObject({
      source: 'custom',
      scope: 'workspace',
      summary: 'Workspace alpha.',
      disabled: false,
    });

    const machineSource = settings.sources.find(({ scope }) => scope === 'machine');
    expect(machineSource?.issues).toEqual(
      expect.arrayContaining([{ path: 'alpha', reason: 'shadowed' }])
    );
    const workspaceSource = settings.sources.find(({ scope }) => scope === 'workspace');
    expect(workspaceSource?.issues).toEqual([]);
  });

  test('rejects a duplicate name in one push and keeps the first definition', async () => {
    const { sessionId, machineId, workingDir } = await setup('duplicate-names');

    const result = await t.mutation(api.customAgents.syncDefinitions, {
      sessionId,
      machineId,
      scope: 'workspace',
      workingDir,
      contentHash: 'hash-1',
      agents: [
        makeAgent('alpha', 'a1', { description: 'First alpha.' }),
        makeAgent('alpha', 'a2', { description: 'Second alpha.' }),
      ],
      issues: [],
    });

    expect(result).toEqual({
      applied: true,
      rejected: [{ name: 'alpha', reason: 'shadowed' }],
    });

    const source = await readSource(machineId, 'workspace', workingDir);
    expect(source!.issues).toEqual(
      expect.arrayContaining([
        { path: 'alpha', reason: 'shadowed', detail: 'duplicate name in one push' },
      ])
    );
    const stored = await readAgents(source!._id);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.description).toBe('First alpha.');
    expect(stored[0]!.contentHash).toBe('a1');
  });

  test('applies a machine-scope disable to every chatroom on that machine', async () => {
    const first = await setupChatroom('machine-wide-disable-a', 'duo', '/test/machine-wide-a');
    const second = await t.mutation(api.chatrooms.createWithWorkspace, {
      sessionId: first.sessionId,
      teamStructureId: 'duo',
      machineId: first.machineId,
      workingDir: '/test/machine-wide-b',
    });

    await t.mutation(api.customAgents.syncDefinitions, {
      sessionId: first.sessionId,
      machineId: first.machineId,
      scope: 'machine',
      contentHash: 'm1',
      agents: [makeAgent('alpha', 'a1', { disabled: true })],
      issues: [],
    });

    for (const chatroomId of [first.chatroomId, second.chatroomId]) {
      const structure = await t.query(api.chatrooms.getTeamStructureForChatroom, {
        sessionId: first.sessionId,
        chatroomId,
      });
      expect(structure!.roles.map(({ role }) => role)).not.toContain('alpha');
    }

    const roster = await t.query(api.customAgents.getTeamRoster, {
      sessionId: first.sessionId,
      chatroomId: first.chatroomId,
    });
    expect(roster.roster.find(({ role }) => role === 'alpha')).toMatchObject({
      source: 'custom',
      disabled: true,
    });
  });

  test('patches only the identity row for a disabled-only change', async () => {
    const { sessionId, machineId, workingDir, chatroomId } =
      await setupChatroom('disable-only-patch');
    await syncWorkspaceAgent(sessionId, machineId, workingDir, makeAgent('alpha', 'a1'));

    const source = await readSource(machineId, 'workspace', workingDir);
    const [before] = await readAgents(source!._id);
    const [contentBefore] = await readContents(before!._id);

    advanceClock(1_000);
    await syncWorkspaceAgent(
      sessionId,
      machineId,
      workingDir,
      makeAgent('alpha', 'a1', { disabled: true }),
      'hash-2'
    );

    const after = (await readAgents(source!._id))[0]!;
    expect(after._id).toBe(before!._id);
    expect(after.disabled).toBe(true);
    expect(after.updatedAt).toBe(FIXED_NOW + 1_000);
    expect(after.contentHash).toBe('a1');
    const [contentAfter] = await readContents(before!._id);
    expect(contentAfter!._id).toBe(contentBefore!._id);

    const structure = await t.query(api.chatrooms.getTeamStructureForChatroom, {
      sessionId,
      chatroomId,
    });
    expect(structure!.roles.map(({ role }) => role)).not.toContain('alpha');
  });

  test('applies a disable toggle pushed with an unchanged source hash', async () => {
    const { sessionId, machineId, workingDir, chatroomId } = await setupChatroom(
      'disable-unchanged-source'
    );
    const agent = makeAgent('alpha', 'a1');
    await syncWorkspaceAgent(sessionId, machineId, workingDir, agent);

    const source = await readSource(machineId, 'workspace', workingDir);
    const [before] = await readAgents(source!._id);
    const [contentBefore] = await readContents(before!._id);
    expect(before!.disabled).toBe(false);

    advanceClock(1_000);
    const disabled = await syncWorkspaceAgent(sessionId, machineId, workingDir, {
      ...agent,
      disabled: true,
    });
    expect(disabled).toEqual({ applied: true, rejected: [] });

    const [afterDisable] = await readAgents(source!._id);
    expect(afterDisable!._id).toBe(before!._id);
    expect(afterDisable!.disabled).toBe(true);
    expect(afterDisable!.updatedAt).toBe(FIXED_NOW + 1_000);
    expect(afterDisable!.contentHash).toBe(before!.contentHash);
    const [contentAfterDisable] = await readContents(before!._id);
    expect(contentAfterDisable!._id).toBe(contentBefore!._id);

    const disabledStructure = await t.query(api.chatrooms.getTeamStructureForChatroom, {
      sessionId,
      chatroomId,
    });
    expect(disabledStructure!.roles.map(({ role }) => role)).not.toContain('alpha');

    advanceClock(1_000);
    const reenabled = await syncWorkspaceAgent(sessionId, machineId, workingDir, agent);
    expect(reenabled).toEqual({ applied: true, rejected: [] });

    const [afterEnable] = await readAgents(source!._id);
    expect(afterEnable!._id).toBe(before!._id);
    expect(afterEnable!.disabled).toBe(false);
    expect(afterEnable!.updatedAt).toBe(FIXED_NOW + 2_000);
    const [contentAfterEnable] = await readContents(before!._id);
    expect(contentAfterEnable!._id).toBe(contentBefore!._id);

    const enabledStructure = await t.query(api.chatrooms.getTeamStructureForChatroom, {
      sessionId,
      chatroomId,
    });
    expect(enabledStructure!.roles.map(({ role }) => role)).toContain('alpha');

    // A push that changes nothing still writes nothing.
    advanceClock(1_000);
    expect(await syncWorkspaceAgent(sessionId, machineId, workingDir, agent)).toEqual({
      applied: false,
      rejected: [],
    });
    const [afterNoop] = await readAgents(source!._id);
    expect(afterNoop!.updatedAt).toBe(FIXED_NOW + 2_000);
  });

  test('rewrites agents when the stored rules version is stale', async () => {
    const { sessionId, machineId, workingDir } = await setup('rules-version');
    const agent = makeAgent('alpha', 'a1');

    await syncWorkspaceAgent(sessionId, machineId, workingDir, agent);
    const source = await readSource(machineId, 'workspace', workingDir);
    const [before] = await readAgents(source!._id);
    const [contentBefore] = await readContents(before!._id);

    await t.run(async (ctx) => {
      await ctx.db.patch('chatroom_customAgentSources', source!._id, { rulesVersion: 'stale' });
    });

    advanceClock(1_000);
    const result = await syncWorkspaceAgent(sessionId, machineId, workingDir, agent);
    expect(result).toEqual({ applied: true, rejected: [] });

    const refreshedSource = await readSource(machineId, 'workspace', workingDir);
    expect(refreshedSource!.rulesVersion).toBe(CUSTOM_AGENT_RULES_VERSION);
    const [contentAfter] = await readContents(before!._id);
    expect(contentAfter!._id).not.toBe(contentBefore!._id);
    expect(contentAfter!.systemPrompt).toBe('You are alpha.');
  });

  test('splits handoff templates out of the content row and deletes both with the agent', async () => {
    const { sessionId, machineId, workingDir } = await setup('template-split');
    await syncWorkspaceAgent(
      sessionId,
      machineId,
      workingDir,
      makeAgent('alpha', 'a1', { inboundHandoffTemplate: 'Hand this to alpha.' })
    );

    const source = await readSource(machineId, 'workspace', workingDir);
    const [agent] = await readAgents(source!._id);
    expect(agent).toMatchObject({
      hasInboundHandoffTemplate: true,
      hasReturnHandoffTemplate: false,
    });
    expect(await readContents(agent!._id)).toEqual([
      expect.objectContaining({ customAgentId: agent!._id, systemPrompt: 'You are alpha.' }),
    ]);
    expect(await readContents(agent!._id)).toHaveLength(1);
    expect(await readHandoffTemplates(agent!._id)).toEqual([
      expect.objectContaining({ direction: 'inbound', body: 'Hand this to alpha.' }),
    ]);

    await t.mutation(api.customAgents.syncDefinitions, {
      sessionId,
      machineId,
      scope: 'workspace',
      workingDir,
      contentHash: 'empty',
      agents: [],
      issues: [],
    });

    expect(await t.run(async (ctx) => ctx.db.get('chatroom_customAgents', agent!._id))).toBeNull();
    expect(await readContents(agent!._id)).toEqual([]);
    expect(await readHandoffTemplates(agent!._id)).toEqual([]);
  });

  test('never merges custom agents into a solo team', async () => {
    const { sessionId, machineId, workingDir, chatroomId } = await setupChatroom(
      'solo-no-customs',
      'solo'
    );
    await syncWorkspaceAgent(sessionId, machineId, workingDir, makeAgent('alpha', 'a1'));

    const structure = await t.query(api.chatrooms.getTeamStructureForChatroom, {
      sessionId,
      chatroomId,
    });
    expect(structure!.roles.map(({ role }) => role)).not.toContain('alpha');
    expect(structure).toEqual(getTeamStructure({ teamId: 'solo' }));
  });

  test('leaves builtin roles untouched and rejects a builtin name at sync', async () => {
    const { sessionId, machineId, workingDir, chatroomId } =
      await setupChatroom('builtin-not-disableable');

    const result = await t.mutation(api.customAgents.syncDefinitions, {
      sessionId,
      machineId,
      scope: 'workspace',
      workingDir,
      contentHash: 'hash-1',
      agents: [makeAgent('architect', 'a1', { disabled: true })],
      issues: [],
    });
    expect(result).toEqual({
      applied: true,
      rejected: [{ name: 'architect', reason: 'reserved-name' }],
    });

    const structure = await t.query(api.chatrooms.getTeamStructureForChatroom, {
      sessionId,
      chatroomId,
    });
    expect(structure!.roles.map(({ role }) => role)).toContain('architect');

    const roster = await t.query(api.customAgents.getTeamRoster, { sessionId, chatroomId });
    expect(roster.roster.find(({ role }) => role === 'architect')).toMatchObject({
      source: 'builtin',
      disabled: false,
      disableable: false,
    });
  });

  test('classifies builtin and custom roles as ephemeral by chatroom membership', async () => {
    const { sessionId, machineId, workingDir, chatroomId } = await setupChatroom('ephemeral-check');
    await syncWorkspaceAgent(sessionId, machineId, workingDir, makeAgent('alpha', 'a1'));

    const isEphemeral = (role: string) =>
      t.run(async (ctx) => isEphemeralRoleInChatroom(ctx, chatroomId, role));

    expect(await isEphemeral('architect')).toBe(true);
    expect(await isEphemeral('planner')).toBe(false);
    expect(await isEphemeral('alpha')).toBe(true);
    expect(await isEphemeral('user')).toBe(false);
    expect(await isEphemeral('enhancer')).toBe(false);
    expect(await isEphemeral('unknown-role')).toBe(false);
  });

  test('matches the static structure exactly when no customs or disabled rows exist', async () => {
    const { sessionId, chatroomId } = await setupChatroom('zero-regression');

    const structure = await t.query(api.chatrooms.getTeamStructureForChatroom, {
      sessionId,
      chatroomId,
    });
    expect(structure).toEqual(getTeamStructure({ teamId: 'duo' }));
  });

  test('joins, sends, and hands off to an enabled custom role', async () => {
    const { sessionId, machineId, workingDir, chatroomId } = await setupChatroom('enabled-custom');
    await syncWorkspaceAgent(sessionId, machineId, workingDir, makeAgent('alpha', 'a1'));

    await expect(
      t.mutation(api.participants.join, {
        sessionId,
        chatroomId,
        role: 'alpha',
        machineId,
        agentType: 'remote',
        action: 'get-next-task:started',
      })
    ).resolves.toBeTruthy();
    await t.mutation(api.participants.join, {
      sessionId,
      chatroomId,
      role: 'planner',
      machineId,
      agentType: 'remote',
      action: 'get-next-task:started',
    });

    const sent = await t.mutation(api.messages.sendMessage, {
      sessionId,
      chatroomId,
      senderRole: 'alpha',
      content: 'custom role reporting in',
      type: 'message',
    });
    expect(sent).toBeTruthy();

    const handoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      content: 'please pick this up',
      targetRole: 'alpha',
    });
    expect(handoff.success).toBe(true);
    expect(handoff.newTaskId).toBeTruthy();

    const task = await t.run(async (ctx) => ctx.db.get('chatroom_tasks', handoff.newTaskId!));
    expect(task?.assignedTo).toBe('alpha');
  });

  test('rejects a handoff to a disabled custom role', async () => {
    const { sessionId, machineId, workingDir, chatroomId } =
      await setupChatroom('disabled-custom-target');
    const agent = makeAgent('alpha', 'a1');
    await syncWorkspaceAgent(sessionId, machineId, workingDir, agent);
    await disableWorkspaceAgent(sessionId, machineId, workingDir, agent);

    const handoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'planner',
      content: 'please pick this up',
      targetRole: 'alpha',
    });
    expect(handoff.success).toBe(false);
    expect(handoff.error?.code).toBe('INVALID_TARGET_ROLE');
  });

  test('excludes a disabled custom role from start-all', async () => {
    const { sessionId, machineId, workingDir, chatroomId } = await setupChatroom(
      'disabled-custom-start-all'
    );
    await syncWorkspaceAgent(sessionId, machineId, workingDir, makeAgent('alpha', 'a1'));
    await disableWorkspaceAgent(sessionId, machineId, workingDir, makeAgent('alpha', 'a1'));

    const result = await t.mutation(api.agents.requestChatroomAgentOperation, {
      sessionId,
      chatroomId,
      operation: 'start',
    });
    const roles = [...result.requested, ...result.skipped, ...result.failed]
      .map(({ role }) => role)
      .filter((role): role is string => role !== undefined);
    expect(roles).not.toContain('alpha');
    expect(roles).toContain('planner');
  });

  test('lets an in-flight custom sender hand back after its definition is removed', async () => {
    const { sessionId, machineId, workingDir, chatroomId } =
      await setupChatroom('in-flight-custom');
    await syncWorkspaceAgent(sessionId, machineId, workingDir, makeAgent('alpha', 'a1'));
    const activeTaskId = await seedActiveTask(chatroomId, 'alpha');

    // Replace the pushed set with no agents, which removes the definition row.
    await t.mutation(api.customAgents.syncDefinitions, {
      sessionId,
      machineId,
      scope: 'workspace',
      workingDir,
      contentHash: 'empty',
      agents: [],
      issues: [],
    });
    const structure = await t.query(api.chatrooms.getTeamStructureForChatroom, {
      sessionId,
      chatroomId,
    });
    expect(structure!.roles.map(({ role }) => role)).not.toContain('alpha');

    const handoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'alpha',
      content: 'finished before removal',
      targetRole: 'planner',
    });
    expect(handoff.success).toBe(true);
    expect(handoff.completedTaskIds).toContain(activeTaskId);

    // With no active task left, the same removed role can no longer send.
    const rejected = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'alpha',
      content: 'late message',
      targetRole: 'planner',
    });
    expect(rejected.success).toBe(false);
    expect(rejected.error?.code).toBe('INVALID_ROLE');
  });
});

async function readRoleStatusRow(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query('chatroom_agentRoleStatusReadModel')
      .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .first()
  );
}

async function insertParticipant(chatroomId: Id<'chatroom_rooms'>, role: string) {
  return await t.run(async (ctx) =>
    ctx.db.insert('chatroom_participants', {
      chatroomId,
      role,
      lastSeenAt: FIXED_NOW,
      lastSeenAction: 'get-next-task:started',
    })
  );
}

async function projectWorking(chatroomId: Id<'chatroom_rooms'>, role: string) {
  await t.run(async (ctx) =>
    projectAgentRoleStatusReadModel(ctx, {
      chatroomId,
      role,
      event: { status: 'working' },
    })
  );
}

async function clearWorkspaceAgents(sessionId: SessionId, machineId: string, workingDir: string) {
  return t.mutation(api.customAgents.syncDefinitions, {
    sessionId,
    machineId,
    scope: 'workspace',
    workingDir,
    contentHash: 'empty',
    agents: [],
    issues: [],
  });
}

describe('custom agent lifecycle after removal', () => {
  test('releases an in-flight custom role after its definition is removed', async () => {
    const { sessionId, machineId, workingDir, chatroomId } =
      await setupChatroom('lifecycle-removed');
    await syncWorkspaceAgent(sessionId, machineId, workingDir, makeAgent('alpha', 'a1'));
    await projectWorking(chatroomId, 'alpha');
    const participantId = await insertParticipant(chatroomId, 'alpha');
    await seedActiveTask(chatroomId, 'alpha');

    await clearWorkspaceAgents(sessionId, machineId, workingDir);

    const handoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'alpha',
      content: 'finished before removal',
      targetRole: 'planner',
    });
    expect(handoff.success).toBe(true);

    const participant = await t.run(async (ctx) =>
      ctx.db.get('chatroom_participants', participantId)
    );
    expect(participant?.lastSeenAction).toBe(PARTICIPANT_EXITED_ACTION);

    const statusRow = await readRoleStatusRow(chatroomId, 'alpha');
    expect(statusRow?.roleKind).toBe('ephemeral');
    expect(await t.run(async (ctx) => isEphemeralRoleInChatroom(ctx, chatroomId, 'alpha'))).toBe(
      true
    );
  });

  test('releases an in-flight custom role after its definition is disabled', async () => {
    const { sessionId, machineId, workingDir, chatroomId } =
      await setupChatroom('lifecycle-disabled');
    const agent = makeAgent('alpha', 'a1');
    await syncWorkspaceAgent(sessionId, machineId, workingDir, agent);
    await projectWorking(chatroomId, 'alpha');
    const participantId = await insertParticipant(chatroomId, 'alpha');
    await seedActiveTask(chatroomId, 'alpha');

    await disableWorkspaceAgent(sessionId, machineId, workingDir, agent);

    const handoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'alpha',
      content: 'finished before disable',
      targetRole: 'planner',
    });
    expect(handoff.success).toBe(true);

    const participant = await t.run(async (ctx) =>
      ctx.db.get('chatroom_participants', participantId)
    );
    expect(participant?.lastSeenAction).toBe(PARTICIPANT_EXITED_ACTION);

    const statusRow = await readRoleStatusRow(chatroomId, 'alpha');
    expect(statusRow?.roleKind).toBe('ephemeral');
    expect(await t.run(async (ctx) => isEphemeralRoleInChatroom(ctx, chatroomId, 'alpha'))).toBe(
      true
    );
  });

  test('never treats a never-projected or reserved name as ephemeral', async () => {
    const { chatroomId } = await setupChatroom('lifecycle-ghost');

    const isEphemeral = (role: string) =>
      t.run(async (ctx) => isEphemeralRoleInChatroom(ctx, chatroomId, role));

    expect(await isEphemeral('ghost')).toBe(false);
    expect(await isEphemeral('user')).toBe(false);
  });

  test('rejects a builtin sender left over after a solo team switch', async () => {
    const { sessionId, chatroomId } = await setupChatroom('lifecycle-solo-sender', 'solo');
    await seedActiveTask(chatroomId, 'builder');

    const handoff = await t.mutation(api.messages.handoff, {
      sessionId,
      chatroomId,
      senderRole: 'builder',
      content: 'late message from a builtin role',
      targetRole: 'planner',
    });
    expect(handoff.success).toBe(false);
    expect(handoff.error?.code).toBe('INVALID_ROLE');
  });
});
