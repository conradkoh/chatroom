/**
 * Chatroom import apply — agent configs.
 *
 * Every spec calls the public `api.chatroomImport` mutations through
 * `convex-test` and reads the database afterwards. The rows are restored by the
 * apply core through `saveAgentConfig`, so a missing launch request, a missing
 * config-inbox event or an unexpected start command fails here.
 *
 * `refs` is supplied by hand in this round: the driver that fills it lands with
 * P8. A chunk's `refs` maps the file key to the target id.
 *
 * Accepted residual: `registerWorkspace` enqueues a `daemon.gitRefresh` command
 * into `chatroom_machineCommandInbox`. That table is machine-keyed, not
 * chatroom-keyed, so rollback leaves the command behind and this import does not
 * compensate for it.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { errorCode } from './convex-test-ports';
import type { ImportChunk, ImportHeader, ImportRowPayload } from './import-apply';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let sessionCounter = 0;
let machineCounter = 0;

interface UserFixture {
  sessionId: SessionId;
  userId: Id<'users'>;
}

async function createUser(): Promise<UserFixture> {
  sessionCounter += 1;
  const sessionId = `import-apply-agent-configs-${sessionCounter}` as SessionId;
  const login = await t.mutation(api.auth.loginAnon, { sessionId });
  return { sessionId, userId: login.userId as Id<'users'> };
}

async function registerMachine(sessionId: SessionId, hostname = 'test-host'): Promise<string> {
  machineCounter += 1;
  const machineId = `import-apply-agent-configs-machine-${machineCounter}`;
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname,
    os: 'darwin',
    availableHarnesses: ['opencode-sdk'],
  });
  await t.mutation(api.machines.markDaemonOnline, { sessionId, machineId });
  return machineId;
}

function header(overrides: Partial<ImportHeader> = {}): ImportHeader {
  return { teamStructureId: 'trio@1', name: 'Imported room', ...overrides };
}

async function begin(
  sessionId: SessionId,
  machineId: string,
  overrides: Partial<ImportHeader> = {}
): Promise<Id<'chatroom_rooms'>> {
  const result = await t.mutation(api.chatroomImport.begin, {
    sessionId,
    header: header(overrides),
    machineId,
  });
  return result.chatroomId;
}

async function apply(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>,
  chunk: ImportChunk
): Promise<{ created: Record<string, string> }> {
  return await t.mutation(api.chatroomImport.applyChunk, { sessionId, chatroomId, chunk });
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the mutation to fail');
}

/** The message a thrown `ConvexError` carries in its `data` payload. */
function errorMessage(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const data = (error as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return undefined;
  const message = (data as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}

const WORKING_DIR = '/work/app';

function workspaceRow(key: string, workingDir = WORKING_DIR): ImportRowPayload {
  return { key, fields: { workingDir } };
}

function agentConfigRow(key: string, overrides: Record<string, unknown> = {}): ImportRowPayload {
  return {
    key,
    fields: {
      role: 'planner',
      agentType: 'remote',
      agentHarness: 'opencode-sdk',
      model: 'model-x',
      workingDir: WORKING_DIR,
      workspaceId: 'w0',
      ...overrides,
    },
  };
}

/** A test room with one registered workspace; the common start of every case. */
async function importRoomWithWorkspace(): Promise<{
  sessionId: SessionId;
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  workspaceId: string;
}> {
  const { sessionId } = await createUser();
  const machineId = await registerMachine(sessionId);
  const chatroomId = await begin(sessionId, machineId);
  const workspaces = await apply(sessionId, chatroomId, {
    phase: 'workspaces',
    machineId,
    rows: [workspaceRow('w0')],
    primaryKey: 'w0',
    refs: {},
  });
  return { sessionId, chatroomId, machineId, workspaceId: workspaces.created.w0 };
}

async function launchRequestsOf(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run((ctx) =>
    ctx.db
      .query('chatroom_agentLastSentLaunchRequests')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );
}

async function configInboxOf(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run((ctx) =>
    ctx.db
      .query('chatroomWorkspaceAgentConfigInbox')
      .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );
}

async function startCommands(): Promise<{ command: { type: string } }[]> {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.query('chatroom_machineCommandInbox').collect();
    return rows.filter((row) => row.command.type === 'agent.requestStart');
  });
}

async function runtimeStatesOf(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.query('chatroom_agentRuntimeStates').collect();
    return rows.filter((row) => row.chatroomId === chatroomId);
  });
}

async function participantsOf(chatroomId: Id<'chatroom_rooms'>) {
  return await t.run((ctx) =>
    ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect()
  );
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

describe('agent configs', () => {
  test('restores a remote config for a surviving workspace without starting an agent', async () => {
    const { sessionId, chatroomId, machineId, workspaceId } = await importRoomWithWorkspace();

    const result = await apply(sessionId, chatroomId, {
      phase: 'agentConfigs',
      machineId,
      rows: [agentConfigRow('a0')],
      refs: { w0: workspaceId },
    });

    expect(result.created.a0).toBeDefined();

    const requests = await launchRequestsOf(chatroomId);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      chatroomId,
      workspaceId,
      machineId,
      model: 'model-x',
      role: 'planner',
      agentType: 'remote',
    });

    const inbox = await configInboxOf(chatroomId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ chatroomId, machineId, role: 'planner', model: 'model-x' });

    expect(await startCommands()).toEqual([]);
    expect(await runtimeStatesOf(chatroomId)).toEqual([]);
    expect(await participantsOf(chatroomId)).toEqual([]);
  });

  test('refuses a workspace that belongs to another chatroom', async () => {
    const { sessionId, chatroomId, machineId } = await importRoomWithWorkspace();
    const otherChatroomId = await t.mutation(api.chatrooms.create, {
      sessionId,
      teamStructureId: 'trio@1',
    });
    const foreignWorkspaceId = await t.run((ctx) =>
      ctx.db.insert('chatroom_workspaces', {
        chatroomId: otherChatroomId,
        machineId,
        hostname: 'test-host',
        workingDir: WORKING_DIR,
        registeredAt: 1,
        registeredBy: 'user',
      })
    );

    const error = await failure(
      apply(sessionId, chatroomId, {
        phase: 'agentConfigs',
        machineId,
        rows: [agentConfigRow('a0')],
        refs: { w0: foreignWorkspaceId },
      })
    );

    expect(errorCode(error)).toBe('IMPORT_CHUNK_FAILED');
    expect(await launchRequestsOf(chatroomId)).toEqual([]);
  });

  test('reports a workspace and machine mismatch as a chunk failure with its message', async () => {
    const { sessionId, chatroomId, workspaceId } = await importRoomWithWorkspace();
    const otherMachineId = await registerMachine(sessionId);

    const error = await failure(
      apply(sessionId, chatroomId, {
        phase: 'agentConfigs',
        machineId: otherMachineId,
        rows: [agentConfigRow('a0')],
        refs: { w0: workspaceId },
      })
    );

    expect(errorCode(error)).toBe('IMPORT_CHUNK_FAILED');
    expect(errorMessage(error)).toContain('Workspace does not belong to this agent configuration');
    expect(await launchRequestsOf(chatroomId)).toEqual([]);
  });

  test('refuses a row that carries a source-machine field', async () => {
    const { sessionId, chatroomId, machineId, workspaceId } = await importRoomWithWorkspace();

    const error = await failure(
      apply(sessionId, chatroomId, {
        phase: 'agentConfigs',
        machineId,
        rows: [agentConfigRow('a0', { machineId })],
        refs: { w0: workspaceId },
      })
    );

    expect(errorCode(error)).toBe('IMPORT_CHUNK_FAILED');
    expect(await launchRequestsOf(chatroomId)).toEqual([]);
  });

  test('rejects a harness the machine does not list', async () => {
    const { sessionId, chatroomId, machineId, workspaceId } = await importRoomWithWorkspace();

    const error = await failure(
      apply(sessionId, chatroomId, {
        phase: 'agentConfigs',
        machineId,
        rows: [agentConfigRow('a0', { agentHarness: 'not-a-harness' })],
        refs: { w0: workspaceId },
      })
    );
    expect(error).toBeDefined();

    expect(await launchRequestsOf(chatroomId)).toEqual([]);
  });
});
