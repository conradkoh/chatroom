/**
 * Tests for the custom-agent prompt context reader.
 *
 * Fixtures mirror `convex/customAgents.spec.ts`: a real Convex test database,
 * a machine owner, a duo chatroom with a registered workspace, and definitions
 * pushed through `customAgents.syncDefinitions` so the stored rows are exactly
 * what the sync path writes.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { readCustomAgentPromptContext } from './read-custom-agent-prompt-context';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { withActiveTeamStructure } from '../../../../convex/lib/chatroomTeam';
import { t } from '../../../../test.setup';

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
  overrides: Partial<Omit<TestAgent, 'name' | 'contentHash'>> = {}
): TestAgent {
  return {
    name,
    description: overrides.description ?? `${name} role.`,
    systemPrompt: overrides.systemPrompt ?? `You are ${name}.`,
    contentHash: `${name}-hash`,
    disabled: overrides.disabled ?? false,
    ...(overrides.inboundHandoffTemplate !== undefined
      ? { inboundHandoffTemplate: overrides.inboundHandoffTemplate }
      : {}),
    ...(overrides.returnHandoffTemplate !== undefined
      ? { returnHandoffTemplate: overrides.returnHandoffTemplate }
      : {}),
  };
}

interface Fixture {
  sessionId: SessionId;
  machineId: string;
  workingDir: string;
  chatroomId: Id<'chatroom_rooms'>;
}

async function setup(suffix: string, teamStructureId = 'duo'): Promise<Fixture> {
  const sessionId = `custom-agent-context-${suffix}` as SessionId;
  const machineId = `custom-agent-context-machine-${suffix}`;
  const workingDir = '/test/workspace';

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
    teamStructureId,
    machineId,
    workingDir,
  });
  return { sessionId, machineId, workingDir, chatroomId };
}

async function syncWorkspaceAgents(
  fixture: Fixture,
  agents: TestAgent[],
  contentHash = 'workspace-hash'
): Promise<void> {
  await t.mutation(api.customAgents.syncDefinitions, {
    sessionId: fixture.sessionId,
    machineId: fixture.machineId,
    scope: 'workspace',
    workingDir: fixture.workingDir,
    contentHash,
    agents,
    issues: [],
  });
}

async function syncMachineAgents(fixture: Fixture, agents: TestAgent[]): Promise<void> {
  await t.mutation(api.customAgents.syncDefinitions, {
    sessionId: fixture.sessionId,
    machineId: fixture.machineId,
    scope: 'machine',
    contentHash: 'machine-hash',
    agents,
    issues: [],
  });
}

const COUNTED_TABLES = [
  'chatroom_customAgentContents',
  'chatroom_customAgentHandoffTemplates',
] as const;
type CountedTable = (typeof COUNTED_TABLES)[number];
type ReadCounts = Record<CountedTable, number>;

const NO_READS: ReadCounts = {
  chatroom_customAgentContents: 0,
  chatroom_customAgentHandoffTemplates: 0,
};

/** Counts table queries so the reader's budget is asserted, not assumed. */
function countingCtx(ctx: QueryCtx, reads: ReadCounts): QueryCtx {
  const db = new Proxy(ctx.db, {
    get(target, property, receiver) {
      if (property !== 'query') return Reflect.get(target, property, receiver);
      return (table: string) => {
        if ((COUNTED_TABLES as readonly string[]).includes(table)) {
          reads[table as CountedTable] += 1;
        }
        return target.query(table as never);
      };
    },
  });
  return { db } as unknown as QueryCtx;
}

async function readContext(
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<{
  context: Awaited<ReturnType<typeof readCustomAgentPromptContext>>;
  reads: ReadCounts;
}> {
  return await t.run(async (ctx) => {
    const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
    if (chatroom === null) throw new Error('chatroom fixture is missing');
    const resolved = await withActiveTeamStructure(ctx, chatroom);

    const reads: ReadCounts = { ...NO_READS };
    const context = await readCustomAgentPromptContext(countingCtx(ctx, reads), {
      chatroom: resolved,
      role,
    });
    return { context, reads };
  });
}

describe('readCustomAgentPromptContext', () => {
  test('does not read the workspace for a builtin role even when customs exist', async () => {
    // Before the builtin guard, `builder` fell through to the stored-row fallback,
    // which read the primary workspace and did two name lookups.
    const fixture = await setup('builtin-with-customs');
    await syncWorkspaceAgents(fixture, [makeAgent('alpha')]);

    const { context, reads } = await readContext(fixture.chatroomId, 'builder');

    expect(context).toBeUndefined();
    expect(reads).toEqual(NO_READS);
  });

  test('normalises a mixed-case role for the stored-row fallback', async () => {
    const fixture = await setup('canonical-fallback');
    await syncWorkspaceAgents(fixture, [makeAgent('alpha', { disabled: true })]);

    const { context } = await readContext(fixture.chatroomId, '  AlPhA  ');

    expect(context?.self?.name).toBe('alpha');
  });

  test('returns undefined for a builtin role when the chatroom has no custom agents', async () => {
    const fixture = await setup('builtin');
    const { context, reads } = await readContext(fixture.chatroomId, 'builder');

    expect(context).toBeUndefined();
    expect(reads).toEqual(NO_READS);
  });

  test('returns self instructions for an enabled custom role', async () => {
    const fixture = await setup('enabled');
    await syncWorkspaceAgents(fixture, [
      makeAgent('alpha', { systemPrompt: 'You are alpha.', description: 'Alpha role.' }),
    ]);

    const { context, reads } = await readContext(fixture.chatroomId, 'alpha');

    expect(context).toEqual({
      entryPoint: 'planner',
      self: {
        name: 'alpha',
        description: 'Alpha role.',
        systemPrompt: 'You are alpha.',
        returnHandoffTemplate: null,
      },
      delegates: [],
    });
    expect(reads).toEqual({
      chatroom_customAgentContents: 1,
      chatroom_customAgentHandoffTemplates: 0,
    });
  });

  test('matches an enabled agent case-insensitively', async () => {
    const fixture = await setup('case-insensitive');
    await syncWorkspaceAgents(fixture, [makeAgent('alpha')]);

    const { context } = await readContext(fixture.chatroomId, 'ALPHA');

    expect(context?.self?.name).toBe('alpha');
  });

  test('reads the stored return template only when the row has one', async () => {
    const fixture = await setup('return-template');
    await syncWorkspaceAgents(fixture, [
      makeAgent('alpha', { returnHandoffTemplate: '## Summary\n\nReturn it.' }),
    ]);

    const { context, reads } = await readContext(fixture.chatroomId, 'alpha');

    expect(context?.self?.returnHandoffTemplate).toBe('## Summary\n\nReturn it.');
    expect(reads).toEqual({
      chatroom_customAgentContents: 1,
      chatroom_customAgentHandoffTemplates: 1,
    });
  });

  test('gives the entry point one delegate per enabled agent and no content reads', async () => {
    const fixture = await setup('entry-point');
    await syncWorkspaceAgents(fixture, [
      makeAgent('alpha', { inboundHandoffTemplate: '## Task\n\nAlpha work.' }),
      makeAgent('beta'),
      makeAgent('gamma', { inboundHandoffTemplate: '## Task\n\nGamma work.' }),
    ]);

    const { context, reads } = await readContext(fixture.chatroomId, 'planner');

    expect(context?.self).toBeUndefined();
    expect(context?.entryPoint).toBe('planner');
    expect(context?.delegates).toEqual([
      {
        name: 'alpha',
        description: 'alpha role.',
        inboundHandoffTemplate: '## Task\n\nAlpha work.',
      },
      { name: 'beta', description: 'beta role.', inboundHandoffTemplate: null },
      {
        name: 'gamma',
        description: 'gamma role.',
        inboundHandoffTemplate: '## Task\n\nGamma work.',
      },
    ]);
    expect(reads).toEqual({
      chatroom_customAgentContents: 0,
      chatroom_customAgentHandoffTemplates: 2,
    });
  });

  test('keeps a disabled custom role’s own instructions through the stored-row fallback', async () => {
    const fixture = await setup('disabled');
    await syncWorkspaceAgents(fixture, [
      makeAgent('alpha', { disabled: true, systemPrompt: 'Disabled alpha still runs.' }),
    ]);

    const { context, reads } = await readContext(fixture.chatroomId, 'alpha');

    expect(context?.self?.systemPrompt).toBe('Disabled alpha still runs.');
    expect(context?.delegates).toEqual([]);
    expect(reads.chatroom_customAgentContents).toBe(1);
  });

  test('prefers the workspace row over the machine row in the fallback', async () => {
    const fixture = await setup('precedence');
    await syncWorkspaceAgents(fixture, [
      makeAgent('alpha', { disabled: true, systemPrompt: 'Workspace alpha.' }),
    ]);
    await syncMachineAgents(fixture, [makeAgent('alpha', { systemPrompt: 'Machine alpha.' })]);

    const { context } = await readContext(fixture.chatroomId, 'alpha');

    expect(context?.self?.systemPrompt).toBe('Workspace alpha.');
  });

  test('returns undefined for a stored custom role in a solo chatroom', async () => {
    // Custom agents never merge into a solo team. The pushed row still exists, so
    // the stored-row fallback must be gated by the team, not only by the name.
    const fixture = await setup('solo', 'solo');
    await syncWorkspaceAgents(fixture, [makeAgent('alpha')]);

    const { context, reads } = await readContext(fixture.chatroomId, 'alpha');

    expect(context).toBeUndefined();
    expect(reads).toEqual(NO_READS);
  });

  test('returns undefined for a role whose definition was removed', async () => {
    const fixture = await setup('removed');
    await syncWorkspaceAgents(fixture, [makeAgent('alpha')]);
    await syncWorkspaceAgents(fixture, [], 'empty');

    const { context } = await readContext(fixture.chatroomId, 'alpha');

    expect(context).toBeUndefined();
  });

  test('returns undefined for an unknown role without touching content or template rows', async () => {
    const fixture = await setup('unknown');
    await syncWorkspaceAgents(fixture, [makeAgent('alpha')]);

    const { context, reads } = await readContext(fixture.chatroomId, 'nobody');

    expect(context).toBeUndefined();
    expect(reads).toEqual(NO_READS);
  });
});
