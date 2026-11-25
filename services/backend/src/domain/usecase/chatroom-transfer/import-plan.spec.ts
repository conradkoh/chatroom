/**
 * Chatroom import — validation and plan (pure specs).
 *
 * Every assertion pins literal codes, keys, counts and chunk sizes so a change
 * in the plan is visible here. The seams are `validateExportFile` (a JSON string
 * in, a result out) and `buildImportPlan` (a file object and a target in, a plan
 * or a refusal out). No persistence is exercised.
 */

import { describe, expect, test } from 'vitest';

import type { ImportChunk, ImportRowPayload, LinkPatch } from './import-apply';
import {
  buildImportPlan,
  validateExportFile,
  type ImportFailure,
  type ImportPlan,
  type ImportPlanResult,
  type ImportTarget,
  type ImportValidation,
} from './import-plan';
import {
  canonicalJson,
  contentOf,
  sha256Hex,
  type ChatroomExportContent,
  type ChatroomExportFileV1,
  type ExportRow,
} from '../../entities/chatroom-transfer-file';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function row(key: string, fields: Record<string, unknown> = {}, creationTime = 1): ExportRow {
  return { _key: key, _creationTime: creationTime, ...fields };
}

function emptyContent(): ChatroomExportContent {
  return {
    room: row('r0', { status: 'active', teamStructureId: 'trio@1' }),
    workspaces: [],
    agentConfigs: [],
    messages: [],
    messageQueue: [],
    tasks: [],
    backlog: [],
    artifacts: [],
    contexts: [],
    scheduledPrompts: [],
    savedCommands: [],
    skillCustomizations: [],
  };
}

/** A small but valid file: one workspace, one agent config, one ref pair. */
function planContent(): ChatroomExportContent {
  const content = emptyContent();
  content.room = row('r0', {
    status: 'active',
    teamStructureId: 'trio@1',
    name: 'Exported room',
    lastActivityAt: 100,
    nextQueuePosition: 2,
  });
  content.workspaces = [
    row('w0', {
      workingDir: '/work/app',
      fileTreeSyncEnabled: false,
      sourceMachineId: 'source-machine',
    }),
  ];
  content.agentConfigs = [
    row('g0', {
      role: 'builder',
      agentType: 'remote',
      agentHarness: 'opencode-sdk',
      model: 'model-a',
      workingDir: '/work/app',
      workspaceId: 'w0',
      sourceMachineId: 'source-machine',
    }),
  ];
  content.messages = [row('m0', { senderRole: 'user', content: 'hello', taskId: 't0' })];
  content.tasks = [
    row('t0', { content: 'do it', status: 'pending', queuePosition: 0, originUserMessageId: 'm0' }),
  ];
  return content;
}

function fileOf(
  content: ChatroomExportContent,
  checksum = 'fixture-checksum'
): ChatroomExportFileV1 {
  return {
    formatVersion: 1,
    kind: 'chatroom-export',
    exportedAt: '2026-01-01T00:00:00.000Z',
    source: { chatroomId: 'chatroom-source', cliVersion: '0.0.0' },
    omitted: {},
    checksum,
    ...content,
  };
}

/** Fixtures are not expected values, so the checksum is computed from the content. */
async function signedFileOf(content: ChatroomExportContent): Promise<ChatroomExportFileV1> {
  const unsigned = fileOf(content);
  return { ...unsigned, checksum: await sha256Hex(canonicalJson(contentOf(unsigned))) };
}

function target(overrides: Partial<ImportTarget> = {}): ImportTarget {
  return {
    machineId: 'machine-target',
    availableHarnesses: ['opencode-sdk'],
    teamStructureKnown: true,
    invalidWorkingDirs: [],
    ...overrides,
  };
}

function failureOf(result: ImportValidation | ImportPlanResult): ImportFailure {
  if (result.ok) throw new Error('expected the import to be refused');
  return result;
}

function planOf(content: ChatroomExportContent, overrides: Partial<ImportTarget> = {}): ImportPlan {
  const result = buildImportPlan(fileOf(content), target(overrides));
  if (!result.ok) throw new Error(`expected a plan, got ${result.code}`);
  return result.plan;
}

function rowsOf(
  plan: ImportPlan,
  phase: Exclude<ImportChunk['phase'], 'links'>
): ImportRowPayload[] {
  return plan.chunks.flatMap((chunk) =>
    chunk.phase === phase && 'rows' in chunk ? chunk.rows : []
  );
}

function patchesOf(plan: ImportPlan): LinkPatch[] {
  return plan.chunks.flatMap((chunk) => (chunk.phase === 'links' ? chunk.patches : []));
}

// ---------------------------------------------------------------------------
// validateExportFile — refusals in order
// ---------------------------------------------------------------------------

describe('validateExportFile refusals', () => {
  test('refuses non-JSON text as IMPORT_FILE_UNREADABLE', async () => {
    const result = await validateExportFile('{ this is not json');

    const failure = failureOf(result);
    expect(failure.code).toBe('IMPORT_FILE_UNREADABLE');
    expect(failure.message).toBe('The file is not valid JSON.');
    expect(failure.details).toEqual([]);
  });

  test('refuses a JSON document that is not a chatroom export', async () => {
    const file = { ...(await signedFileOf(emptyContent())), kind: 'other' };
    const failure = failureOf(await validateExportFile(JSON.stringify(file)));

    expect(failure.code).toBe('IMPORT_NOT_AN_EXPORT');
  });

  test('refuses an unsupported format version and names the version found', async () => {
    const file = { ...(await signedFileOf(emptyContent())), formatVersion: 2 };
    const failure = failureOf(await validateExportFile(JSON.stringify(file)));

    expect(failure.code).toBe('IMPORT_UNSUPPORTED_VERSION');
    expect(failure.message).toContain('2');
  });

  test('refuses content that no longer matches the checksum', async () => {
    const file = await signedFileOf(planContent());
    const tampered = {
      ...file,
      messages: [{ ...(file.messages[0] as ExportRow), content: 'changed after export' }],
    };
    const failure = failureOf(await validateExportFile(JSON.stringify(tampered)));

    expect(failure.code).toBe('IMPORT_CHECKSUM_MISMATCH');
  });

  test('refuses a row with a missing required shape field and names the path', async () => {
    const content = planContent();
    content.messages = [row('m0', { senderRole: 'user', content: 'hello' })];
    (content.messages[0] as Record<string, unknown>)._creationTime = undefined;
    content.tasks = [];
    const file = await signedFileOf(content);

    const failure = failureOf(await validateExportFile(JSON.stringify(file)));

    expect(failure.code).toBe('IMPORT_FILE_UNREADABLE');
    expect(failure.details).toEqual(['messages[0]._creationTime']);
  });

  test('refuses a dangling reference and reports the table, field and key', async () => {
    const content = planContent();
    content.messages = [row('m0', { senderRole: 'user', content: 'hello', taskId: 't9' })];
    const file = await signedFileOf(content);

    const failure = failureOf(await validateExportFile(JSON.stringify(file)));

    expect(failure.code).toBe('IMPORT_DANGLING_REFERENCE');
    expect(failure.details).toEqual(['chatroom_messages.taskId → t9']);
  });

  test('reports every dangling reference, not only the first one', async () => {
    const content = planContent();
    content.messages = [
      row('m0', {
        senderRole: 'user',
        content: 'hello',
        taskId: 't9',
        attachedMessageIds: ['m8', 'm0'],
      }),
    ];
    const file = await signedFileOf(content);

    const failure = failureOf(await validateExportFile(JSON.stringify(file)));

    expect(failure.details).toEqual([
      'chatroom_messages.taskId → t9',
      'chatroom_messages.attachedMessageIds → m8',
    ]);
  });

  test('refuses a room primary workspace that is not in the file', async () => {
    const content = planContent();
    content.room = { ...content.room, primaryWorkspaceKey: 'w9' };
    const file = await signedFileOf(content);

    const failure = failureOf(await validateExportFile(JSON.stringify(file)));

    expect(failure.code).toBe('IMPORT_DANGLING_REFERENCE');
    expect(failure.details).toEqual(['chatroom_primaryWorkspaces.workspaceId → w9']);
  });

  test('refuses duplicate row keys across the content', async () => {
    const content = planContent();
    content.messages = [
      row('m0', { senderRole: 'user', content: 'first' }),
      row('m0', { senderRole: 'user', content: 'second' }),
    ];
    content.tasks = [];
    const file = await signedFileOf(content);

    const failure = failureOf(await validateExportFile(JSON.stringify(file)));

    expect(failure.code).toBe('IMPORT_FILE_UNREADABLE');
    expect(failure.details).toEqual(['chatroom_messages.m0']);
  });

  test('accepts a valid file', async () => {
    const file = await signedFileOf(planContent());

    const result = await validateExportFile(JSON.stringify(file));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.room.teamStructureId).toBe('trio@1');
  });
});

// ---------------------------------------------------------------------------
// buildImportPlan — refusals
// ---------------------------------------------------------------------------

describe('buildImportPlan refusals', () => {
  test('refuses an unknown team structure before any row work', () => {
    const failure = failureOf(
      buildImportPlan(fileOf(planContent()), target({ teamStructureKnown: false }))
    );

    expect(failure.code).toBe('IMPORT_UNKNOWN_TEAM_STRUCTURE');
    expect(failure.details).toEqual(['trio@1']);
  });

  test('refuses invalid working directories and names each one', () => {
    const failure = failureOf(
      buildImportPlan(fileOf(planContent()), target({ invalidWorkingDirs: ['/a\\b'] }))
    );

    expect(failure.code).toBe('IMPORT_INVALID_WORKING_DIR');
    expect(failure.details).toEqual(['/a\\b']);
  });
});

// ---------------------------------------------------------------------------
// buildImportPlan — transforms
// ---------------------------------------------------------------------------

describe('workspace collapse', () => {
  test('merges normalized duplicates, keeps file-tree sync and rewrites refs', () => {
    const content = planContent();
    content.workspaces = [
      row('w0', { workingDir: '/work/app', fileTreeSyncEnabled: false, sourceMachineId: 'src' }),
      row('w1', { workingDir: '/work/app/', fileTreeSyncEnabled: true, sourceMachineId: 'src' }),
    ];
    content.agentConfigs = [
      row('g0', {
        role: 'builder',
        agentType: 'remote',
        agentHarness: 'opencode-sdk',
        model: 'model-a',
        workingDir: '/work/app',
        workspaceId: 'w1',
        sourceMachineId: 'src',
      }),
    ];
    content.room = { ...content.room, primaryWorkspaceKey: 'w1' };

    const plan = planOf(content);

    expect(rowsOf(plan, 'workspaces')).toEqual([
      { key: 'w0', fields: { workingDir: '/work/app', fileTreeSyncEnabled: true } },
    ]);
    expect(plan.report.merged).toEqual([{ workingDir: '/work/app', keys: ['w0', 'w1'] }]);
    expect(plan.report.counts.workspaces).toBe(1);
    expect(rowsOf(plan, 'agentConfigs')).toEqual([
      {
        key: 'g0',
        fields: {
          role: 'builder',
          agentType: 'remote',
          agentHarness: 'opencode-sdk',
          model: 'model-a',
          workingDir: '/work/app',
          workspaceId: 'w0',
        },
      },
    ]);

    const workspaceChunk = plan.chunks.find((chunk) => chunk.phase === 'workspaces');
    if (!workspaceChunk || workspaceChunk.phase !== 'workspaces') {
      throw new Error('expected a workspaces chunk');
    }
    expect(workspaceChunk.primaryKey).toBe('w0');
  });
});

describe('ref deferral', () => {
  test('moves a forward ref into a links patch and keeps a backward ref in its row', () => {
    const plan = planOf(planContent());

    expect(rowsOf(plan, 'messages')).toEqual([
      { key: 'm0', fields: { senderRole: 'user', content: 'hello' } },
    ]);
    expect(rowsOf(plan, 'tasks')).toEqual([
      {
        key: 't0',
        fields: {
          content: 'do it',
          status: 'pending',
          queuePosition: 0,
          originUserMessageId: 'm0',
        },
      },
    ]);
    expect(patchesOf(plan)).toEqual([{ table: 'messages', key: 'm0', fields: { taskId: 't0' } }]);
  });

  test('defers a same-chunk artifact version link as one whole field', () => {
    const content = planContent();
    content.artifacts = [
      row('a0', { filename: 'a.txt', version: 1 }),
      row('a1', { filename: 'a.txt', version: 2, previousVersionId: 'a0' }),
    ];

    const plan = planOf(content);

    expect(rowsOf(plan, 'artifacts')).toEqual([
      { key: 'a0', fields: { filename: 'a.txt', version: 1 } },
      { key: 'a1', fields: { filename: 'a.txt', version: 2 } },
    ]);
    expect(patchesOf(plan)).toContainEqual({
      table: 'artifacts',
      key: 'a1',
      fields: { previousVersionId: 'a0' },
    });
  });

  test('defers a whole array field instead of splitting it', () => {
    const content = planContent();
    // 201 messages makes two chunks: m0 and m1 share chunk 0, m200 is in chunk 1.
    content.messages = Array.from({ length: 201 }, (_, index) =>
      row(`m${index}`, { senderRole: 'user', content: `message ${index}` })
    );
    content.messages[0] = row('m0', {
      senderRole: 'user',
      content: 'hello',
      attachedMessageIds: ['m1', 'm200'],
    });
    content.tasks = [];

    const plan = planOf(content);

    expect(rowsOf(plan, 'messages')[0]).toEqual({
      key: 'm0',
      fields: { senderRole: 'user', content: 'hello' },
    });
    expect(patchesOf(plan)).toContainEqual({
      table: 'messages',
      key: 'm0',
      fields: { attachedMessageIds: ['m1', 'm200'] },
    });
  });
});

describe('task reset', () => {
  test('resets an in-progress task to pending and drops its delivery state', () => {
    const content = planContent();
    content.tasks = [
      row('t0', {
        content: 'active task',
        status: 'in_progress',
        queuePosition: 3,
        acknowledgedAt: 40,
        startedAt: 50,
        sessionPolicyConsumedAt: 60,
        deliveryFailure: 'boom',
      }),
    ];
    content.messages = [];

    const plan = planOf(content);

    expect(rowsOf(plan, 'tasks')).toEqual([
      { key: 't0', fields: { content: 'active task', status: 'pending', queuePosition: 3 } },
    ]);
    expect(plan.report.tasksReset).toBe(1);
  });

  test('keeps a completed task verbatim and does not count it as reset', () => {
    const content = planContent();
    content.tasks = [
      row('t0', {
        content: 'done',
        status: 'completed',
        queuePosition: 1,
        acknowledgedAt: 40,
        startedAt: 50,
        completedAt: 90,
      }),
    ];
    content.messages = [];

    const plan = planOf(content);

    expect(rowsOf(plan, 'tasks')).toEqual([
      {
        key: 't0',
        fields: {
          content: 'done',
          status: 'completed',
          queuePosition: 1,
          acknowledgedAt: 40,
          startedAt: 50,
          completedAt: 90,
        },
      },
    ]);
    expect(plan.report.tasksReset).toBe(0);
  });
});

describe('scheduled prompts', () => {
  test('imports every prompt paused and keeps only completed/failed reasons', () => {
    const content = planContent();
    content.scheduledPrompts = [
      row('s0', { name: 'archived', prompt: 'p0', isRunnable: true, disabledReason: 'archive' }),
      row('s1', { name: 'finished', prompt: 'p1', isRunnable: true, disabledReason: 'completed' }),
      row('s2', { name: 'failed', prompt: 'p2', isRunnable: true, disabledReason: 'failed' }),
      row('s3', { name: 'active', prompt: 'p3', isRunnable: true }),
    ];

    const plan = planOf(content);

    expect(rowsOf(plan, 'scheduledPrompts')).toEqual([
      {
        key: 's0',
        fields: { name: 'archived', prompt: 'p0', isRunnable: false, disabledReason: 'user' },
      },
      {
        key: 's1',
        fields: { name: 'finished', prompt: 'p1', isRunnable: false, disabledReason: 'completed' },
      },
      {
        key: 's2',
        fields: { name: 'failed', prompt: 'p2', isRunnable: false, disabledReason: 'failed' },
      },
      {
        key: 's3',
        fields: { name: 'active', prompt: 'p3', isRunnable: false, disabledReason: 'user' },
      },
    ]);
    expect(plan.report.scheduledPromptsDisabled).toBe(4);
  });
});

describe('agent configs', () => {
  test('skips each failing check in order and keeps the last row per workspace and role', () => {
    const content = planContent();
    content.agentConfigs = [
      row('g0', {
        role: 'builder',
        agentType: 'remote',
        agentHarness: 'unknown-harness',
        model: 'model-a',
        workingDir: '/work/app',
        workspaceId: 'w0',
      }),
      row('g1', {
        role: 'builder',
        agentType: 'custom',
        agentHarness: 'opencode-sdk',
        model: 'model-a',
        workingDir: '/work/app',
        workspaceId: 'w0',
      }),
      row('g2', {
        role: 'builder',
        agentType: 'remote',
        agentHarness: 'opencode-sdk',
        model: '   ',
        workingDir: '/work/app',
        workspaceId: 'w0',
      }),
      row('g3', {
        role: 'builder',
        agentType: 'remote',
        agentHarness: 'opencode-sdk',
        model: 'model-a',
        workingDir: '/work/app',
        workspaceId: 'w9',
      }),
      row('g4', {
        role: 'builder',
        agentType: 'remote',
        agentHarness: 'opencode-sdk',
        model: 'first',
        workingDir: '/work/app',
        workspaceId: 'w0',
      }),
      row('g5', {
        role: 'builder',
        agentType: 'remote',
        agentHarness: 'opencode-sdk',
        model: 'last',
        workingDir: '/work/app',
        workspaceId: 'w0',
      }),
    ];

    const plan = planOf(content);

    expect(rowsOf(plan, 'agentConfigs')).toEqual([
      {
        key: 'g5',
        fields: {
          role: 'builder',
          agentType: 'remote',
          agentHarness: 'opencode-sdk',
          model: 'last',
          workingDir: '/work/app',
          workspaceId: 'w0',
        },
      },
    ]);
    expect(plan.report.agentConfigsSkipped).toEqual([
      { key: 'g0', reason: 'harness_unavailable' },
      { key: 'g1', reason: 'non_remote_agent_type' },
      { key: 'g2', reason: 'empty_model' },
      { key: 'g3', reason: 'no_workspace' },
      { key: 'g4', reason: 'superseded_by_merge' },
    ]);
    expect(plan.report.agentConfigsRestored).toBe(1);
    expect(plan.report.counts.agentConfigs).toBe(1);
  });
});

describe('queue position', () => {
  test('is one past the highest task and queued-message position', () => {
    const content = planContent();
    content.tasks = [row('t0', { content: 't', status: 'pending', queuePosition: 7 })];
    content.messageQueue = [
      row('q0', { senderRole: 'user', content: 'q', type: 'message', queuePosition: 4 }),
    ];
    content.messages = [];

    const plan = planOf(content);

    expect(plan.finalize.nextQueuePosition).toBe(8);
    expect(rowsOf(plan, 'messageQueue')).toEqual([
      {
        key: 'q0',
        fields: { senderRole: 'user', content: 'q', type: 'message', queuePosition: 4 },
      },
    ]);
  });
});

describe('chunk sizing', () => {
  test('splits 450 messages into 200, 200 and 50 rows', () => {
    const content = planContent();
    content.messages = Array.from({ length: 450 }, (_, index) =>
      row(`m${index}`, { senderRole: 'user', content: `message ${index}` }, index)
    );
    content.tasks = [];

    const plan = planOf(content);
    const messageChunks = plan.chunks.filter((chunk) => chunk.phase === 'messages');

    expect(messageChunks.map((chunk) => ('rows' in chunk ? chunk.rows.length : 0))).toEqual([
      200, 200, 50,
    ]);
  });

  test('puts each row over the byte cap in its own chunk', () => {
    const content = planContent();
    const big = 'a'.repeat(1_200_000);
    content.messages = [
      row('m0', { senderRole: 'user', content: big }),
      row('m1', { senderRole: 'user', content: big }),
    ];
    content.tasks = [];

    const plan = planOf(content);
    const messageChunks = plan.chunks.filter((chunk) => chunk.phase === 'messages');

    expect(messageChunks.map((chunk) => ('rows' in chunk ? chunk.rows.length : 0))).toEqual([1, 1]);
  });
});

describe('determinism', () => {
  test('the same input yields a deep-equal plan', () => {
    const content = planContent();
    content.artifacts = [
      row('a0', { filename: 'a.txt', version: 1 }),
      row('a1', { filename: 'a.txt', version: 2, previousVersionId: 'a0' }),
    ];

    expect(planOf(content)).toEqual(planOf(content));
  });
});

describe('plan shape', () => {
  test('copies the header and finalize values from the room', () => {
    const content = planContent();
    content.room = {
      ...content.room,
      standingInstructions: 'Be careful',
      standingInstructionsEnabled: true,
      standingInstructionsTitle: 'Rules',
    };

    const plan = planOf(content);

    expect(plan.header).toEqual({
      teamStructureId: 'trio@1',
      name: 'Exported room',
      standingInstructions: 'Be careful',
      standingInstructionsEnabled: true,
      standingInstructionsTitle: 'Rules',
    });
    expect(plan.finalize).toEqual({
      status: 'active',
      lastActivityAt: 100,
      nextQueuePosition: 2,
    });
    expect(plan.chunks.every((chunk) => Object.keys(chunk.refs).length === 0)).toBe(true);
    expect(plan.report.messageTimesNotPreserved).toBe(true);
  });
});
