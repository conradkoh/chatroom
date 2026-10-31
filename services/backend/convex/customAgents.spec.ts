import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';

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
      expect.objectContaining({
        systemPrompt: 'You are alpha, updated.',
        inboundHandoffTemplate: 'inbound',
      }),
    ]);
    expect(await readContents(patched._id)).toHaveLength(1);

    advanceClock(1_000);
    await sync('hash-3', [makeAgent('beta', 'b1')]);

    const thirdSource = await readSource(machineId, 'workspace', workingDir);
    expect(thirdSource!.agentCount).toBe(1);
    const remaining = await readAgents(thirdSource!._id);
    expect(remaining.map(({ name }) => name)).toEqual(['beta']);
    expect(await readContents(patched._id)).toEqual([]);
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
