/**
 * Chatroom transfer — full round trip.
 *
 * Exports a source room holding one row (or several) in every exported category,
 * imports the file into a second machine, exports the new room, and compares the
 * two files. The comparison is the test: `diffCanonical` walks both content
 * objects positionally and reports every difference, and `EXPECTED_ROUND_TRIP_DIFFS`
 * is the hand-written list of the differences the design documents (task reset,
 * workspace rebind and collapse, agent-config merge/skip, paused prompts).
 *
 * The fixture is inserted with `t.run`, never through the product mutations, so a
 * failure names the planner or the apply core rather than a fixture helper.
 *
 * The target machine differs from every source machine, so `sourceMachineId`
 * changes on the restored workspaces and agent configs. `M_SRC`/`M_OTHER`/`M_TGT`
 * are literals because the expected list is literal.
 */

import type { SessionId } from 'convex-helpers/server/sessions';
import { describe, expect, test } from 'vitest';

import { exportPortFor, importPortFor } from './convex-test-ports';
import { runExport } from './export-driver';
import { runImport } from './import-driver';
import { omittedManifest } from './registry';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { t } from '../../../../test.setup';
import { contentOf, type ChatroomExportFileV1 } from '../../entities/chatroom-transfer-file';

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

interface DiffEntry {
  path: string;
  kind: 'changed' | 'removed' | 'added';
  before?: unknown;
  after?: unknown;
}

/** Deep copy with every `_creationTime` key dropped; the import never restores it. */
function withoutCreationTimes<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripCreationTimes) as T;
  if (isRecord(value)) return stripCreationObject(value) as T;
  return value;
}

function stripCreationTimes(value: unknown): unknown {
  return withoutCreationTimes(value);
}

function stripCreationObject(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === '_creationTime') continue;
    out[key] = withoutCreationTimes(entry);
  }
  return out;
}

/**
 * Positional canonical diff. Arrays compare index by index (a missing index is
 * `removed` or `added`), objects compare the union of keys alphabetically, and
 * `_key` is skipped because ordinals renumber after a workspace collapse.
 */
function diffCanonical(a: unknown, b: unknown): DiffEntry[] {
  const entries: DiffEntry[] = [];
  walk(a, b, '', entries);
  return entries;
}

function walk(a: unknown, b: unknown, path: string, entries: DiffEntry[]): void {
  if (a === b) return;
  if (Array.isArray(a) || Array.isArray(b)) {
    walkArray(a, b, path, entries);
    return;
  }
  if (isRecord(a) && isRecord(b)) {
    walkObject(a, b, path, entries);
    return;
  }
  entries.push({ path, kind: 'changed', before: a, after: b });
}

function walkArray(a: unknown, b: unknown, path: string, entries: DiffEntry[]): void {
  const left = Array.isArray(a) ? a : [];
  const right = Array.isArray(b) ? b : [];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    walkArrayItem(left, right, index, indexedPath(path, index), entries);
  }
}

function walkArrayItem(
  left: unknown[],
  right: unknown[],
  index: number,
  path: string,
  entries: DiffEntry[]
): void {
  if (index >= right.length) {
    entries.push({ path, kind: 'removed', before: left[index] });
    return;
  }
  if (index >= left.length) {
    entries.push({ path, kind: 'added', after: right[index] });
    return;
  }
  walk(left[index], right[index], path, entries);
}

function walkObject(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  path: string,
  entries: DiffEntry[]
): void {
  for (const key of sortedUnionKeys(a, b)) {
    if (key === '_key') continue;
    walkObjectField(a, b, key, path, entries);
  }
}

function walkObjectField(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  key: string,
  path: string,
  entries: DiffEntry[]
): void {
  const fieldPath = propertyPath(path, key);
  if (!(key in b)) {
    entries.push({ path: fieldPath, kind: 'removed', before: a[key] });
    return;
  }
  if (!(key in a)) {
    entries.push({ path: fieldPath, kind: 'added', after: b[key] });
    return;
  }
  walk(a[key], b[key], fieldPath, entries);
}

function sortedUnionKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
}

function indexedPath(path: string, index: number): string {
  return `${path}[${index}]`;
}

function propertyPath(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const M_SRC = 'round-trip-machine-src';
const M_OTHER = 'round-trip-machine-other';
const M_TGT = 'round-trip-machine-tgt';

const SESSION_ID = 'round-trip-session' as SessionId;

const EXPORTED_AT = '2026-01-01T00:00:00.000Z';

interface SourceFixture {
  sessionId: SessionId;
  userId: Id<'users'>;
  chatroomId: Id<'chatroom_rooms'>;
  targetMachineId: string;
  /** Every row id the fixture inserted, except the room; none may reach the file. */
  rowIds: string[];
}

/** Built once: the machine ids are literals so the expected diff list can be literal. */
let sourceFixture: Promise<SourceFixture> | undefined;

function source(): Promise<SourceFixture> {
  sourceFixture ??= buildSourceFixture();
  return sourceFixture;
}

async function buildSourceFixture(): Promise<SourceFixture> {
  const login = await t.mutation(api.auth.loginAnon, { sessionId: SESSION_ID });
  const userId = login.userId as Id<'users'>;
  await registerMachine(SESSION_ID, M_SRC, 'src-host');
  await registerMachine(SESSION_ID, M_OTHER, 'other-host');
  await registerMachine(SESSION_ID, M_TGT, 'tgt-host');

  const chatroomId = await t.mutation(api.chatrooms.create, {
    sessionId: SESSION_ID,
    teamStructureId: 'trio@1',
  });
  const rowIds: string[] = [];
  await insertFixtureRows(chatroomId, userId, rowIds);

  return { sessionId: SESSION_ID, userId, chatroomId, targetMachineId: M_TGT, rowIds };
}

async function registerMachine(
  sessionId: SessionId,
  machineId: string,
  hostname: string
): Promise<void> {
  await t.mutation(api.machines.register, {
    sessionId,
    machineId,
    hostname,
    os: 'darwin',
    availableHarnesses: ['opencode-sdk'],
  });
  await t.mutation(api.machines.markDaemonOnline, { sessionId, machineId });
}

/** Inserts the fixture. Each category's rows are inserted in the order the export reads them. */
async function insertFixtureRows(
  chatroomId: Id<'chatroom_rooms'>,
  userId: Id<'users'>,
  ids: string[]
): Promise<void> {
  await t.run(async (ctx) => {
    const remember = <TT>(id: TT): TT => {
      ids.push(String(id));
      return id;
    };

    await ctx.db.patch('chatroom_rooms', chatroomId, {
      name: 'Round trip source',
      status: 'active',
      lastActivityAt: 1_767_225_600_000,
      nextQueuePosition: 10,
      standingInstructions: 'Be precise.',
      standingInstructionsEnabled: true,
      standingInstructionsTitle: 'House rules',
    });

    // Workspaces: w0/w1 on the source machine, w2 removed (filtered), w3 the
    // trailing duplicate on another machine that collapses into w0.
    const w0 = remember(
      await ctx.db.insert('chatroom_workspaces', {
        chatroomId,
        machineId: M_SRC,
        workingDir: '/repo/main',
        hostname: 'src-host',
        registeredAt: 900,
        registeredBy: 'user',
        fileTreeSyncEnabled: true,
      })
    );
    const w1 = remember(
      await ctx.db.insert('chatroom_workspaces', {
        chatroomId,
        machineId: M_SRC,
        workingDir: '/repo/other',
        hostname: 'src-host',
        registeredAt: 901,
        registeredBy: 'user',
        fileTreeSyncEnabled: false,
      })
    );
    remember(
      await ctx.db.insert('chatroom_workspaces', {
        chatroomId,
        machineId: M_SRC,
        workingDir: '/repo/removed',
        hostname: 'src-host',
        registeredAt: 902,
        registeredBy: 'user',
        removedAt: 999,
      })
    );
    const w3 = remember(
      await ctx.db.insert('chatroom_workspaces', {
        chatroomId,
        machineId: M_OTHER,
        workingDir: '/repo/main',
        hostname: 'other-host',
        registeredAt: 903,
        registeredBy: 'user',
      })
    );
    await ctx.db.insert('chatroom_primaryWorkspaces', {
      chatroomId,
      workspaceId: w0,
      updatedAt: 950,
    });

    // Agent configs: c0 is superseded by c1 after the collapse, c2's harness is
    // absent on the target, c3 belongs to another team (filtered).
    remember(
      await ctx.db.insert('chatroom_agentLastSentLaunchRequests', {
        requestKey: 'src:c0',
        requestId: 'req-c0',
        commandId: 'cmd-c0',
        chatroomId,
        teamStructureId: 'trio@1',
        role: 'planner',
        agentType: 'remote',
        machineId: M_SRC,
        workspaceId: w0,
        agentHarness: 'opencode-sdk',
        model: 'model-planner-a',
        workingDir: '/repo/main',
        reason: 'user.config',
        wantResume: false,
        requestedBy: userId,
        requestedAt: 100,
      })
    );
    remember(
      await ctx.db.insert('chatroom_agentLastSentLaunchRequests', {
        requestKey: 'src:c1',
        requestId: 'req-c1',
        commandId: 'cmd-c1',
        chatroomId,
        teamStructureId: 'trio@1',
        role: 'planner',
        agentType: 'remote',
        machineId: M_OTHER,
        workspaceId: w3,
        agentHarness: 'opencode-sdk',
        model: 'model-planner-b',
        workingDir: '/repo/main',
        reason: 'user.config',
        wantResume: false,
        requestedBy: userId,
        requestedAt: 200,
      })
    );
    remember(
      await ctx.db.insert('chatroom_agentLastSentLaunchRequests', {
        requestKey: 'src:c2',
        requestId: 'req-c2',
        commandId: 'cmd-c2',
        chatroomId,
        teamStructureId: 'trio@1',
        role: 'reviewer',
        agentType: 'remote',
        machineId: M_SRC,
        workspaceId: w1,
        agentHarness: 'pi-sdk',
        model: 'model-reviewer',
        workingDir: '/repo/other',
        reason: 'user.config',
        wantResume: false,
        requestedBy: userId,
        requestedAt: 300,
      })
    );
    remember(
      await ctx.db.insert('chatroom_agentLastSentLaunchRequests', {
        requestKey: 'src:c3',
        requestId: 'req-c3',
        commandId: 'cmd-c3',
        chatroomId,
        teamStructureId: 'other-team@1',
        role: 'builder',
        agentType: 'remote',
        machineId: M_SRC,
        workspaceId: w0,
        agentHarness: 'opencode-sdk',
        model: 'model-other-team',
        workingDir: '/repo/main',
        reason: 'user.config',
        wantResume: false,
        requestedBy: userId,
        requestedAt: 400,
      })
    );

    // Tasks: three non-terminal (each carrying stale delivery state) and two terminal.
    const t0 = remember(
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Prepare release notes',
        status: 'pending',
        assignedTo: 'builder',
        queuePosition: 0,
        createdAt: 200,
        updatedAt: 201,
        sessionPolicyConsumedAt: 202,
      })
    );
    remember(
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Acknowledge the release',
        status: 'acknowledged',
        assignedTo: 'builder',
        queuePosition: 1,
        createdAt: 210,
        updatedAt: 211,
        acknowledgedAt: 210,
      })
    );
    remember(
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Write the changelog',
        status: 'in_progress',
        assignedTo: 'builder',
        queuePosition: 2,
        createdAt: 220,
        updatedAt: 222,
        startedAt: 220,
        deliveryFailure: { reason: 'delivery_retrying', occurredAt: 221 },
      })
    );
    remember(
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Shipped the changelog',
        status: 'completed',
        assignedTo: 'builder',
        queuePosition: 3,
        createdAt: 230,
        updatedAt: 231,
        completedAt: 231,
      })
    );
    remember(
      await ctx.db.insert('chatroom_tasks', {
        chatroomId,
        createdBy: 'user',
        content: 'Dropped the release',
        status: 'closed',
        queuePosition: 4,
        createdAt: 240,
        updatedAt: 241,
      })
    );

    // Artifacts: two versions of one group.
    const a0 = remember(
      await ctx.db.insert('chatroom_artifacts', {
        chatroomId,
        artifactGroupId: 'group-release',
        filename: 'release.md',
        description: 'Release notes',
        mimeType: 'text/markdown',
        content: '# v1',
        version: 1,
        isLatest: false,
        createdBy: 'builder',
        createdAt: 400,
      })
    );
    remember(
      await ctx.db.insert('chatroom_artifacts', {
        chatroomId,
        artifactGroupId: 'group-release',
        filename: 'release.md',
        description: 'Release notes',
        mimeType: 'text/markdown',
        content: '# v2',
        version: 2,
        isLatest: true,
        previousVersionId: a0,
        createdBy: 'builder',
        createdAt: 401,
      })
    );

    // Backlog: three retained rows plus one filtered deleted row.
    const b0 = remember(
      await ctx.db.insert('chatroom_backlog', {
        chatroomId,
        createdBy: 'user',
        content: 'Add a changelog page',
        status: 'backlog',
        assignedTo: 'builder',
        legacyTaskId: t0,
        createdAt: 300,
        updatedAt: 301,
      })
    );
    const b1 = remember(
      await ctx.db.insert('chatroom_backlog', {
        chatroomId,
        createdBy: 'user',
        content: 'Review the changelog',
        status: 'pending_user_review',
        createdAt: 310,
        updatedAt: 311,
      })
    );
    remember(
      await ctx.db.insert('chatroom_backlog', {
        chatroomId,
        createdBy: 'user',
        content: 'Close the release',
        status: 'closed',
        closeReason: 'duplicate',
        createdAt: 320,
        updatedAt: 321,
      })
    );
    remember(
      await ctx.db.insert('chatroom_backlog', {
        chatroomId,
        createdBy: 'user',
        content: 'Delete the release',
        status: 'deleted',
        createdAt: 330,
        updatedAt: 331,
      })
    );

    // Scheduled prompts: two live ones and one completed and one failed `once`.
    const s0 = remember(
      await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        name: 'Interval check',
        prompt: 'Check the queue',
        scheduleKind: 'interval',
        intervalMinutes: 15,
        isRunnable: true,
        createdBy: userId,
        createdAt: 600,
        updatedAt: 601,
      })
    );
    remember(
      await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        name: 'Daily digest',
        prompt: 'Summarise the day',
        scheduleKind: 'daily',
        hourUTC: 9,
        minuteUTC: 30,
        isRunnable: true,
        createdBy: userId,
        createdAt: 610,
        updatedAt: 611,
      })
    );
    remember(
      await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        name: 'Once completed',
        prompt: 'Already ran',
        scheduleKind: 'once',
        runAt: 1_767_225_600_000,
        isRunnable: false,
        disabledReason: 'completed',
        lastRunAt: 622,
        createdBy: userId,
        createdAt: 620,
        updatedAt: 621,
      })
    );
    remember(
      await ctx.db.insert('chatroom_scheduledPrompts', {
        chatroomId,
        name: 'Once failed',
        prompt: 'Already failed',
        scheduleKind: 'once',
        runAt: 1_767_225_600_000,
        isRunnable: false,
        disabledReason: 'failed',
        createdBy: userId,
        createdAt: 630,
        updatedAt: 631,
      })
    );

    // Messages m0..m5, in export order.
    const m0 = remember(
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'Plan the release',
        type: 'plan',
      })
    );
    remember(
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'Plan the release, revised',
        type: 'plan',
        supersedesPlanId: m0,
      })
    );
    const m2 = remember(
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'builder',
        content: 'Release notes are attached',
        targetRole: 'user',
        type: 'handoff',
        attachedArtifactIds: [a0],
        attachedMessageIds: [m0],
        attachedBacklogItemIds: [b0, b1],
        scheduledPromptId: s0,
      })
    );
    remember(
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'Please build it',
        type: 'message',
        taskId: t0,
        senderAgent: { harness: 'opencode-sdk', model: 'model-sender' },
      })
    );
    remember(
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'user',
        content: 'With a snippet',
        type: 'message',
        attachedSnippets: [
          { reference: 'src/index.ts:1', fileSource: 'explorer', selectedContent: 'const x = 1;' },
        ],
      })
    );
    remember(
      await ctx.db.insert('chatroom_messages', {
        chatroomId,
        senderRole: 'builder',
        content: 'Handing back to the user',
        targetRole: 'user',
        type: 'handoff',
        taskOriginMessageId: m0,
        terminalHandoffKey: `${chatroomId}:${m0}:builder:user`,
      })
    );

    // One queued message that references the handoff above.
    remember(
      await ctx.db.insert('chatroom_messageQueue', {
        chatroomId,
        senderRole: 'user',
        targetRole: 'planner',
        content: 'Ship it after the fix',
        type: 'message',
        queuePosition: 5,
        attachedMessageIds: [m2],
      })
    );

    // One context snapshot triggered by the handoff.
    remember(
      await ctx.db.insert('chatroom_contexts', {
        chatroomId,
        content: 'Release context',
        createdBy: 'user',
        createdAt: 500,
        messageCountAtCreation: 3,
        triggerMessageId: m2,
      })
    );

    // Saved commands: one chatroom-scoped (exported) and one user-scoped (not).
    remember(
      await ctx.db.insert('chatroom_savedCommands', {
        type: 'prompt',
        scope: 'chatroom',
        chatroomId,
        name: 'Ship it',
        prompt: 'Ship the release',
        createdBy: 'user',
        createdAt: 700,
        updatedAt: 701,
      })
    );
    remember(
      await ctx.db.insert('chatroom_savedCommands', {
        type: 'prompt',
        scope: 'user',
        ownerId: userId,
        name: 'Personal note',
        prompt: 'Private prompt',
        createdBy: 'user',
        createdAt: 710,
        updatedAt: 711,
      })
    );

    // One skill customization.
    remember(
      await ctx.db.insert('chatroom_skillCustomizations', {
        type: 'development_workflow',
        chatroomId,
        ownerId: userId,
        name: 'Release workflow',
        content: 'Run the release checks.',
        isEnabled: true,
        createdAt: 800,
        updatedAt: 801,
      })
    );
  });
}

async function exportRoom(
  sessionId: SessionId,
  chatroomId: Id<'chatroom_rooms'>
): Promise<{ file: ChatroomExportFileV1; json: string }> {
  return await runExport(exportPortFor(t, sessionId), {
    chatroomId,
    cliVersion: 'test',
    now: () => new Date(EXPORTED_AT),
  });
}

async function importFile(sessionId: SessionId, json: string, machineId: string): Promise<string> {
  const outcome = await runImport(importPortFor(t, sessionId), {
    json,
    machineId,
    dryRun: false,
  });
  if (outcome.status !== 'imported') {
    throw new Error(`expected an imported outcome, got ${outcome.status}`);
  }
  return outcome.chatroomId;
}

/** The `_key` ordinals the fixture expects; a filtered row shifts nothing but its own slot. */
function expectFixtureKeyOrder(file: ChatroomExportFileV1): void {
  expect(file.room._key).toBe('r0');
  // w3 is the trailing duplicate; w2 (removed) was filtered, so w3 becomes w2.
  expect(file.workspaces.map((row) => row._key)).toEqual(['w0', 'w1', 'w2']);
  expect(file.agentConfigs.map((row) => row._key)).toEqual(['g0', 'g1', 'g2']);
  expect(file.messages.map((row) => row._key)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
  expect(file.messageQueue.map((row) => row._key)).toEqual(['q0']);
  expect(file.tasks.map((row) => row._key)).toEqual(['t0', 't1', 't2', 't3', 't4']);
  expect(file.backlog.map((row) => row._key)).toEqual(['b0', 'b1', 'b2']);
  expect(file.artifacts.map((row) => row._key)).toEqual(['a0', 'a1']);
  expect(file.contexts.map((row) => row._key)).toEqual(['c0']);
  expect(file.scheduledPrompts.map((row) => row._key)).toEqual(['s0', 's1', 's2', 's3']);
  expect(file.savedCommands.map((row) => row._key)).toEqual(['k0']);
  expect(file.skillCustomizations.map((row) => row._key)).toEqual(['z0']);
}

// ---------------------------------------------------------------------------
// Expected differences, written by hand from the fixture table
// ---------------------------------------------------------------------------

const EXPECTED_ROUND_TRIP_DIFFS: DiffEntry[] = [
  // The merge winner c1 replaces c0 (model and machine change); c1's own file slot
  // disappears because it was re-keyed onto w0, and the reviewer row is skipped.
  {
    path: 'agentConfigs[0].model',
    kind: 'changed',
    before: 'model-planner-a',
    after: 'model-planner-b',
  },
  { path: 'agentConfigs[0].sourceMachineId', kind: 'changed', before: M_SRC, after: M_TGT },
  {
    path: 'agentConfigs[1]',
    kind: 'removed',
    before: {
      _key: 'g1',
      agentHarness: 'opencode-sdk',
      agentType: 'remote',
      model: 'model-planner-b',
      role: 'planner',
      sourceMachineId: M_OTHER,
      workingDir: '/repo/main',
      workspaceId: 'w2',
    },
  },
  {
    path: 'agentConfigs[2]',
    kind: 'removed',
    before: {
      _key: 'g2',
      agentHarness: 'pi-sdk',
      agentType: 'remote',
      model: 'model-reviewer',
      role: 'reviewer',
      sourceMachineId: M_SRC,
      workingDir: '/repo/other',
      workspaceId: 'w1',
    },
  },
  // Every imported prompt is paused; only a completed/failed reason survives.
  { path: 'scheduledPrompts[0].disabledReason', kind: 'added', after: 'user' },
  { path: 'scheduledPrompts[0].isRunnable', kind: 'changed', before: true, after: false },
  { path: 'scheduledPrompts[1].disabledReason', kind: 'added', after: 'user' },
  { path: 'scheduledPrompts[1].isRunnable', kind: 'changed', before: true, after: false },
  // The three non-terminal tasks return to pending and lose their delivery state.
  { path: 'tasks[0].sessionPolicyConsumedAt', kind: 'removed', before: 202 },
  { path: 'tasks[1].acknowledgedAt', kind: 'removed', before: 210 },
  { path: 'tasks[1].status', kind: 'changed', before: 'acknowledged', after: 'pending' },
  {
    path: 'tasks[2].deliveryFailure',
    kind: 'removed',
    before: { reason: 'delivery_retrying', occurredAt: 221 },
  },
  { path: 'tasks[2].startedAt', kind: 'removed', before: 220 },
  { path: 'tasks[2].status', kind: 'changed', before: 'in_progress', after: 'pending' },
  // w0 and w1 are rebound to the target machine; the duplicate w3 collapses into w0.
  { path: 'workspaces[0].sourceMachineId', kind: 'changed', before: M_SRC, after: M_TGT },
  { path: 'workspaces[1].sourceMachineId', kind: 'changed', before: M_SRC, after: M_TGT },
  {
    path: 'workspaces[2]',
    kind: 'removed',
    before: { _key: 'w2', sourceMachineId: M_OTHER, workingDir: '/repo/main' },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('full chatroom round trip', () => {
  test('round trip differs only in the documented ways', async () => {
    const fixture = await source();
    const a = await exportRoom(fixture.sessionId, fixture.chatroomId);

    expectFixtureKeyOrder(a.file);
    expect(Object.keys(a.file.omitted).sort()).toEqual(Object.keys(omittedManifest()).sort());
    expect(a.file.omitted.backlogDeleted).toEqual({
      count: 1,
      reason: omittedManifest().backlogDeleted.reason,
    });
    expect(a.file.omitted.workspaceRemovals).toEqual({
      count: 1,
      reason: omittedManifest().workspaceRemovals.reason,
    });
    expect(a.file.omitted.launchRequestsOtherTeam).toEqual({
      count: 1,
      reason: omittedManifest().launchRequestsOtherTeam.reason,
    });
    expect(a.file.omitted.launchRequestsSuperseded.count).toBe(0);
    expect(a.file.omitted.attachedWorkflows.count).toBe(0);
    // A non-counted entry keeps `count: null` and its registry reason.
    expect(a.file.omitted.chatroom_integrations).toEqual(omittedManifest().chatroom_integrations);

    const importedId = (await importFile(
      fixture.sessionId,
      a.json,
      fixture.targetMachineId
    )) as Id<'chatroom_rooms'>;
    const b = await exportRoom(fixture.sessionId, importedId);

    expect(
      diffCanonical(
        withoutCreationTimes(contentOf(a.file)),
        withoutCreationTimes(contentOf(b.file))
      )
    ).toEqual(EXPECTED_ROUND_TRIP_DIFFS);
  });

  test('every message row round-trips equal and in order', async () => {
    const fixture = await source();
    const a = await exportRoom(fixture.sessionId, fixture.chatroomId);

    const importedId = (await importFile(
      fixture.sessionId,
      a.json,
      fixture.targetMachineId
    )) as Id<'chatroom_rooms'>;
    const b = await exportRoom(fixture.sessionId, importedId);

    expect(b.file.messages.map(stripKeyAndCreationTime)).toEqual(
      a.file.messages.map(stripKeyAndCreationTime)
    );
    expect(b.file.messages.map((row) => row.terminalHandoffRole)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'builder',
    ]);
  });

  test('the file has no Convex id and no user id', async () => {
    const fixture = await source();
    const a = await exportRoom(fixture.sessionId, fixture.chatroomId);
    const serialized = JSON.stringify(a.file);

    // `source.chatroomId` is the one intentional identifier in the file.
    expect(a.file.source.chatroomId).toBe(fixture.chatroomId);
    expect(fixture.rowIds).not.toContain(fixture.chatroomId);

    for (const rowId of fixture.rowIds) {
      expect(serialized, `row id ${rowId} leaked into the file`).not.toContain(rowId);
    }
    expect(serialized).not.toContain(fixture.userId);
  });

  test('re-importing the same file creates an independent chatroom', async () => {
    const fixture = await source();
    const a = await exportRoom(fixture.sessionId, fixture.chatroomId);

    const first = await importFile(fixture.sessionId, a.json, fixture.targetMachineId);
    const firstMessageCount = await messageCount(first as Id<'chatroom_rooms'>);
    const second = await importFile(fixture.sessionId, a.json, fixture.targetMachineId);

    expect(second).not.toBe(first);
    expect(await messageCount(first as Id<'chatroom_rooms'>)).toBe(firstMessageCount);
    expect(await messageCount(second as Id<'chatroom_rooms'>)).toBe(firstMessageCount);
    expect(firstMessageCount).toBe(a.file.messages.length);
  });
});

/** Drops `_key` and `_creationTime`, the two fields the file never restores. */
function stripKeyAndCreationTime(row: Record<string, unknown>): Record<string, unknown> {
  const { _key: _ignoredKey, _creationTime: _ignoredCreation, ...rest } = row;
  return rest;
}

async function messageCount(chatroomId: Id<'chatroom_rooms'>): Promise<number> {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .collect();
    return rows.length;
  });
}
