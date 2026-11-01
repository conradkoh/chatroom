/**
 * Daemon replay: take the exact `syncDefinitions` payload the CLI daemon pushes
 * (captured by `packages/cli/.../push-capture.test.ts`), feed it to the real
 * backend, and assert that resolution and the roster see the agent.
 *
 * The fixture carries placeholders for the session, machine, and working dir, so
 * this spec supplies its own session and registers the workspace itself.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { FunctionArgs } from 'convex/server';
import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { t } from '../test.setup';
import { api } from './_generated/api';
import { resolveChatroomTeam } from '../src/domain/usecase/team/resolve-chatroom-team';

type SyncArgs = FunctionArgs<typeof api.customAgents.syncDefinitions>;
/** The fixture stores a plain placeholder session; this spec substitutes a real one. */
type Fixture = Omit<SyncArgs, 'sessionId'> & { sessionId: string };

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./testdata/custom-agent-daemon-push.json', import.meta.url)),
    'utf8'
  )
) as Fixture;

const AGENT_NAME = 'x';

function syncArgs(sessionId: SessionId): SyncArgs {
  return { ...FIXTURE, sessionId };
}

async function setupChatroom(sessionId: SessionId) {
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  expect(login.success).toBe(true);
  await t.mutation(api.machines.register, {
    sessionId,
    machineId: FIXTURE.machineId,
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode'],
  });
  const { chatroomId } = await t.mutation(api.chatrooms.createWithWorkspace, {
    sessionId,
    teamStructureId: 'duo',
    machineId: FIXTURE.machineId,
    workingDir: FIXTURE.workingDir,
  });
  return chatroomId;
}

describe('daemon push replay', () => {
  // One test keeps the shared convex-test database honest: the source rows are
  // keyed by machine + scope + workingDir, so a second chatroom on the same
  // fixture workspace would already see the agent from a previous test.
  test('the captured payload is accepted, resolves, and is idempotent on replay', async () => {
    const sessionId = 'custom-agent-daemon-replay' as SessionId;
    const chatroomId = await setupChatroom(sessionId);

    const first = await t.mutation(api.customAgents.syncDefinitions, syncArgs(sessionId));
    expect(first).toEqual({ applied: true, rejected: [] });

    const resolved = await t.run(async (ctx) => resolveChatroomTeam(ctx, chatroomId));
    const agent = resolved?.enabledCustomAgents.find((entry) => entry.name === AGENT_NAME);
    expect(agent).toBeDefined();
    expect(agent?.description).toBe(FIXTURE.agents[0]?.description);
    expect(agent?.scope).toBe('workspace');
    expect(resolved?.roster.find((entry) => entry.role === AGENT_NAME)).toMatchObject({
      source: 'custom',
      disabled: false,
    });

    const roster = await t.query(api.customAgents.getTeamRoster, { sessionId, chatroomId });
    expect(roster.roster.find((entry) => entry.role === AGENT_NAME)).toMatchObject({
      source: 'custom',
      disabled: false,
      summary: FIXTURE.agents[0]?.description,
    });
    expect(roster.sources.find((source) => source.scope === 'workspace')?.agentCount).toBe(1);

    const replay = await t.mutation(api.customAgents.syncDefinitions, syncArgs(sessionId));
    expect(replay).toEqual({ applied: false, rejected: [] });
  });
});
