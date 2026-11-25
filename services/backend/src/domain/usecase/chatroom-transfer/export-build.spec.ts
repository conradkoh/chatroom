/**
 * Chatroom export build — semantics.
 *
 * Pure fixtures over raw rows (the shape `readExportPage` returns): no database,
 * no Convex imports. These specs pin the key assignment, ref rewriting, filters,
 * refusal behaviour, renames, output-field whitelist, checksum and omitted
 * manifest. Paging, consistency and auth are covered by the driver and Convex
 * specs.
 */

import { describe, expect, test } from 'vitest';

import { buildExportFile } from './export-build';
import type { ExportRawRow, ExportStamp } from './export-read';
import { CHATROOM_SCOPED_TABLES, omittedManifest } from './registry';
import { ChatroomTransferError, type ExportCategory } from '../../entities/chatroom-transfer-file';

const ROOM_ID = 'room-source';
const DEFAULT_EXPORTED_AT = '2026-01-01T00:00:00.000Z';

function rawRow(id: string, creationTime: number, fields: Record<string, unknown>): ExportRawRow {
  return { id, creationTime, fields };
}

function emptyRaw(): Record<ExportCategory, ExportRawRow[]> {
  return {
    room: [],
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

function emptyStamp(): ExportStamp {
  return {
    lastActivityAt: null,
    nextQueuePosition: null,
    latestMessage: null,
    taskCounts: null,
    latest: {},
    attachmentRows: { count: 0, capped: false },
  };
}

/** The room row the reader composes: copy fields + team structure + primary pointer. */
function roomRow(fields: Record<string, unknown> = {}): ExportRawRow {
  return rawRow(ROOM_ID, 1, {
    status: 'active',
    name: 'Source room',
    teamStructureId: 'duo',
    ...fields,
  });
}

interface BuildOptions {
  stamp?: ExportStamp;
  exportedAt?: string;
}

async function build(
  raw: Partial<Record<ExportCategory, ExportRawRow[]>>,
  options: BuildOptions = {}
) {
  return buildExportFile({
    sourceChatroomId: ROOM_ID,
    cliVersion: '1.2.3',
    exportedAt: options.exportedAt ?? DEFAULT_EXPORTED_AT,
    raw: { ...emptyRaw(), ...raw },
    stamp: options.stamp ?? emptyStamp(),
  });
}

async function capture(promise: Promise<unknown>): Promise<ChatroomTransferError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ChatroomTransferError) return error;
    throw error;
  }
  throw new Error('expected the build to fail');
}

function message(
  id: string,
  creationTime: number,
  fields: Record<string, unknown> = {}
): ExportRawRow {
  return rawRow(id, creationTime, {
    senderRole: 'user',
    content: `content of ${id}`,
    type: 'message',
    ...fields,
  });
}

// ---------------------------------------------------------------------------
// Keys and references
// ---------------------------------------------------------------------------

describe('ordinal keys and reference rewriting', () => {
  test('assigns keys in read order and rewrites refs, including forward references', async () => {
    const file = await build({
      room: [roomRow()],
      messages: [
        message('message-1', 10, { taskId: 'task-1', attachedMessageIds: ['message-2'] }),
        message('message-2', 11),
      ],
      tasks: [
        rawRow('task-1', 12, {
          content: 'do it',
          status: 'pending',
          sourceMessageId: 'message-1',
        }),
      ],
    });

    expect(file.room._key).toBe('r0');
    expect(file.messages.map((row) => row._key)).toEqual(['m0', 'm1']);
    expect(file.tasks.map((row) => row._key)).toEqual(['t0']);

    // Forward ref (message comes before task) and same-category forward ref.
    expect(file.messages[0].taskId).toBe('t0');
    expect(file.messages[0].attachedMessageIds).toEqual(['m1']);
    expect(file.tasks[0].sourceMessageId).toBe('m0');
  });

  test('refs to filtered rows are removed from arrays and omitted when scalar', async () => {
    const file = await build({
      room: [roomRow({ primaryWorkspaceId: 'workspace-removed' })],
      workspaces: [
        rawRow('workspace-live', 10, { workingDir: '/repo/a', machineId: 'machine-a' }),
        rawRow('workspace-removed', 11, {
          workingDir: '/repo/b',
          machineId: 'machine-a',
          removedAt: 99,
        }),
      ],
      messages: [
        message('message-1', 12, {
          attachedBacklogItemIds: ['backlog-deleted'],
        }),
      ],
      backlog: [rawRow('backlog-deleted', 13, { content: 'gone', status: 'deleted' })],
    });

    expect(file.room).not.toHaveProperty('primaryWorkspaceKey');
    expect(file.messages[0].attachedBacklogItemIds).toEqual([]);
  });

  test('throws EXPORT_DANGLING_REFERENCE with the source path and id', async () => {
    const error = await capture(
      build({
        room: [roomRow()],
        messages: [message('message-1', 10, { taskId: 'missing-task' })],
      })
    );

    expect(error.code).toBe('EXPORT_DANGLING_REFERENCE');
    expect(error.details).toContain('chatroom_messages.taskId → missing-task');
  });
});

// ---------------------------------------------------------------------------
// Filters and counts
// ---------------------------------------------------------------------------

describe('filters and counted omissions', () => {
  test('drops removed workspaces, deleted backlog rows, other-team and superseded launch requests', async () => {
    const file = await build({
      room: [roomRow({ teamStructureId: 'duo', primaryWorkspaceId: 'workspace-2' })],
      workspaces: [
        rawRow('workspace-1', 10, { workingDir: '/repo/a', machineId: 'machine-a' }),
        rawRow('workspace-2', 11, {
          workingDir: '/repo/b',
          machineId: 'machine-a',
          removedAt: 99,
        }),
      ],
      backlog: [
        rawRow('backlog-1', 12, { content: 'gone', status: 'deleted' }),
        rawRow('backlog-2', 13, { content: 'kept', status: 'backlog' }),
      ],
      agentConfigs: [
        rawRow('launch-1', 14, {
          role: 'builder',
          workspaceId: 'workspace-1',
          teamStructureId: 'duo',
          requestedAt: 100,
          machineId: 'machine-a',
          model: 'model-old',
        }),
        rawRow('launch-2', 15, {
          role: 'builder',
          workspaceId: 'workspace-1',
          teamStructureId: 'duo',
          requestedAt: 200,
          machineId: 'machine-a',
          model: 'model-new',
        }),
        rawRow('launch-3', 16, {
          role: 'planner',
          workspaceId: 'workspace-1',
          teamStructureId: 'other-team',
          requestedAt: 300,
          machineId: 'machine-a',
          model: 'model',
        }),
        rawRow('launch-4', 17, {
          role: 'planner',
          workspaceId: 'workspace-2',
          teamStructureId: 'duo',
          requestedAt: 400,
          machineId: 'machine-a',
          model: 'model',
        }),
      ],
    });

    expect(file.workspaces.map((row) => row._key)).toEqual(['w0']);
    expect(file.workspaces[0].workingDir).toBe('/repo/a');
    expect(file.room).not.toHaveProperty('primaryWorkspaceKey');

    expect(file.backlog.map((row) => row._key)).toEqual(['b0']);
    expect(file.backlog[0].content).toBe('kept');

    // Only the latest launch request for (workspace-1, builder) survives.
    expect(file.agentConfigs).toHaveLength(1);
    expect(file.agentConfigs[0]._key).toBe('g0');
    expect(file.agentConfigs[0].model).toBe('model-new');
    expect(file.agentConfigs[0]).not.toHaveProperty('requestedAt');
    expect(file.agentConfigs[0]).not.toHaveProperty('teamStructureId');

    expect(file.omitted.workspaceRemovals.count).toBe(2); // workspace-2 + launch-4
    expect(file.omitted.backlogDeleted.count).toBe(1);
    expect(file.omitted.launchRequestsOtherTeam.count).toBe(1);
    expect(file.omitted.launchRequestsSuperseded.count).toBe(1);
  });

  test('counts and removes deprecated workflow attachments', async () => {
    const file = await build({
      room: [roomRow()],
      messages: [message('message-1', 10, { attachedWorkflowIds: ['workflow-1', 'workflow-2'] })],
      messageQueue: [
        rawRow('queue-1', 11, {
          senderRole: 'user',
          content: 'later',
          type: 'message',
          queuePosition: 0,
          attachedWorkflowIds: ['workflow-3'],
        }),
      ],
    });

    expect(file.omitted.attachedWorkflows.count).toBe(3);
    expect(file.messages[0]).not.toHaveProperty('attachedWorkflowIds');
    expect(file.messageQueue[0]).not.toHaveProperty('attachedWorkflowIds');
  });

  test('omitted has exactly the manifest keys, with every counted key numeric', async () => {
    const file = await build({ room: [roomRow()] });

    expect(Object.keys(file.omitted).sort()).toEqual(Object.keys(omittedManifest()).sort());
    for (const key of [
      'workspaceRemovals',
      'backlogDeleted',
      'launchRequestsOtherTeam',
      'launchRequestsSuperseded',
      'attachedWorkflows',
    ]) {
      expect(file.omitted[key].count, `${key} count`).toBe(0);
    }
    expect(file.omitted.chatroom_integrations.count).toBeNull();
    expect(file.omitted.chatroom_integrations.reason).toBe(
      omittedManifest().chatroom_integrations.reason
    );
  });
});

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

describe('attachment refusal', () => {
  test('refuses when the stamp reports attachment rows and names the count', async () => {
    const error = await capture(
      build(
        { room: [roomRow()] },
        { stamp: { ...emptyStamp(), attachmentRows: { count: 3, capped: false } } }
      )
    );

    expect(error.code).toBe('EXPORT_ATTACHMENTS_PRESENT');
    expect(error.message).toContain('3 file attachment');
  });

  test('refuses when a message references an attachment and names the message count', async () => {
    const error = await capture(
      build({
        room: [roomRow()],
        messages: [message('message-1', 10, { attachedFileIds: ['file-1'] })],
      })
    );

    expect(error.code).toBe('EXPORT_ATTACHMENTS_PRESENT');
    expect(error.message).toContain('1 message');
  });
});

// ---------------------------------------------------------------------------
// Renames: rebind and derive
// ---------------------------------------------------------------------------

describe('rebind and derive renames', () => {
  test('writes machineId as sourceMachineId and terminalHandoffKey as terminalHandoffRole', async () => {
    const file = await build({
      room: [roomRow()],
      workspaces: [rawRow('workspace-1', 10, { workingDir: '/repo', machineId: 'machine-source' })],
      agentConfigs: [
        rawRow('launch-1', 11, {
          role: 'builder',
          workspaceId: 'workspace-1',
          teamStructureId: 'duo',
          requestedAt: 5,
          machineId: 'machine-source',
          model: 'model',
        }),
      ],
      messages: [
        message('message-1', 12, {
          senderRole: 'builder',
          type: 'handoff',
          terminalHandoffKey: `${ROOM_ID}:message-0:builder:user`,
        }),
      ],
    });

    expect(file.workspaces[0].sourceMachineId).toBe('machine-source');
    expect(file.workspaces[0]).not.toHaveProperty('machineId');
    expect(file.agentConfigs[0].sourceMachineId).toBe('machine-source');
    expect(file.agentConfigs[0]).not.toHaveProperty('machineId');

    expect(file.messages[0].terminalHandoffRole).toBe('builder');
    expect(file.messages[0]).not.toHaveProperty('terminalHandoffKey');
  });
});

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

/** Field names a table's rule set may emit, after renames. */
function expectedOutputFields(table: string): string[] {
  const entry = CHATROOM_SCOPED_TABLES[table];
  if (entry.classification !== 'exported') {
    throw new Error(`test fixture: ${table} is not exported`);
  }
  const names: string[] = [];
  for (const [field, rule] of Object.entries(entry.fields)) {
    switch (rule.rule) {
      case 'copy':
      case 'reset':
      case 'ref':
        names.push(field);
        break;
      case 'rebind':
        names.push('sourceMachineId');
        break;
      case 'derive':
        names.push('terminalHandoffRole');
        break;
      case 'system':
      case 'drop':
        break;
    }
  }
  return names;
}

function copyFieldNames(table: string): string[] {
  const entry = CHATROOM_SCOPED_TABLES[table];
  if (entry.classification !== 'exported') {
    throw new Error(`test fixture: ${table} is not exported`);
  }
  return Object.entries(entry.fields)
    .filter(([, rule]) => rule.rule === 'copy')
    .map(([field]) => field);
}

const CATEGORY_TABLES: readonly [Exclude<ExportCategory, 'room'>, string][] = [
  ['workspaces', 'chatroom_workspaces'],
  ['agentConfigs', 'chatroom_agentLastSentLaunchRequests'],
  ['messages', 'chatroom_messages'],
  ['messageQueue', 'chatroom_messageQueue'],
  ['tasks', 'chatroom_tasks'],
  ['backlog', 'chatroom_backlog'],
  ['artifacts', 'chatroom_artifacts'],
  ['contexts', 'chatroom_contexts'],
  ['scheduledPrompts', 'chatroom_scheduledPrompts'],
  ['savedCommands', 'chatroom_savedCommands'],
  ['skillCustomizations', 'chatroom_skillCustomizations'],
];

/** One row per table, with every ref pointing at a retained row. */
function fullFixture(): Record<ExportCategory, ExportRawRow[]> {
  return {
    room: [roomRow({ primaryWorkspaceId: 'workspace-1' })],
    workspaces: [
      rawRow('workspace-1', 10, {
        workingDir: '/repo',
        machineId: 'machine-a',
        fileTreeSyncEnabled: true,
      }),
    ],
    agentConfigs: [
      rawRow('launch-1', 11, {
        role: 'builder',
        agentType: 'remote',
        agentHarness: 'opencode',
        model: 'model',
        workingDir: '/repo',
        workspaceId: 'workspace-1',
        machineId: 'machine-a',
        teamStructureId: 'duo',
        requestedAt: 1,
      }),
    ],
    messages: [
      message('message-1', 12),
      message('message-2', 13, {
        senderRole: 'builder',
        type: 'handoff',
        supersedesPlanId: 'message-1',
        taskOriginMessageId: 'message-1',
        attachedMessageIds: ['message-1'],
        taskId: 'task-1',
        attachedTaskIds: ['task-1'],
        attachedBacklogItemIds: ['backlog-1'],
        attachedArtifactIds: ['artifact-1'],
        scheduledPromptId: 'prompt-1',
        terminalHandoffKey: `${ROOM_ID}:message-1:builder:user`,
      }),
    ],
    messageQueue: [
      rawRow('queue-1', 14, {
        senderRole: 'user',
        content: 'queued',
        type: 'message',
        queuePosition: 0,
        attachedTaskIds: ['task-1'],
        attachedBacklogItemIds: ['backlog-1'],
        attachedArtifactIds: ['artifact-1'],
        attachedMessageIds: ['message-1'],
        scheduledPromptId: 'prompt-1',
      }),
    ],
    tasks: [
      rawRow('task-1', 15, {
        createdBy: 'user',
        content: 'do it',
        status: 'pending',
        acknowledgedAt: 15,
        createdAt: 15,
        updatedAt: 15,
        queuePosition: 0,
        sourceMessageId: 'message-1',
        originUserMessageId: 'message-1',
        attachedTaskIds: ['task-1'],
        parentTaskIds: ['task-1'],
      }),
    ],
    backlog: [
      rawRow('backlog-1', 16, {
        createdBy: 'user',
        content: 'later',
        status: 'backlog',
        createdAt: 16,
        updatedAt: 16,
      }),
    ],
    artifacts: [
      rawRow('artifact-1', 17, {
        artifactGroupId: 'group-1',
        filename: 'artifact.md',
        content: '# artifact',
        version: 1,
        isLatest: true,
        createdBy: 'builder',
        createdAt: 17,
        previousVersionId: 'artifact-1',
      }),
    ],
    contexts: [
      rawRow('context-1', 18, {
        content: 'context',
        createdBy: 'user',
        createdAt: 18,
        triggerMessageId: 'message-1',
      }),
    ],
    scheduledPrompts: [
      rawRow('prompt-1', 19, {
        name: 'Prompt',
        prompt: 'Run it',
        scheduleKind: 'interval',
        intervalMinutes: 5,
        taskEnvelope: {},
        isRunnable: true,
        createdAt: 19,
        updatedAt: 19,
      }),
    ],
    savedCommands: [
      rawRow('command-1', 20, {
        type: 'prompt',
        scope: 'chatroom',
        name: 'Command',
        prompt: 'Run it',
        createdBy: 'user',
        createdAt: 20,
        updatedAt: 20,
      }),
    ],
    skillCustomizations: [
      rawRow('skill-1', 21, {
        type: 'development_workflow',
        name: 'Skill',
        content: 'content',
        isEnabled: true,
        createdAt: 21,
        updatedAt: 21,
      }),
    ],
  };
}

describe('output field whitelist', () => {
  test('every output row has only rule-emitted fields plus _key and _creationTime', async () => {
    const file = await build(fullFixture());

    for (const [category, table] of CATEGORY_TABLES) {
      const allowed = new Set([...expectedOutputFields(table), '_key', '_creationTime']);
      for (const row of file[category]) {
        for (const key of Object.keys(row)) {
          expect(allowed.has(key), `${table} output row has unexpected field ${key}`).toBe(true);
        }
      }
    }

    const roomAllowed = new Set([
      ...copyFieldNames('chatroom_rooms'),
      ...copyFieldNames('chatroom_activeTeamStructures'),
      'primaryWorkspaceKey',
      '_key',
      '_creationTime',
    ]);
    for (const key of Object.keys(file.room)) {
      expect(roomAllowed.has(key), `room output row has unexpected field ${key}`).toBe(true);
    }

    // Spot checks for `system` and `drop` rules that must never be emitted.
    expect(file.room).not.toHaveProperty('ownerId');
    expect(file.room).not.toHaveProperty('teamId');
    expect(file.workspaces[0]).not.toHaveProperty('removedAt');
    expect(file.messages[1]).not.toHaveProperty('attachedFileIds');
    expect(file.messages[1]).not.toHaveProperty('chatroomId');
    expect(file.tasks[0]).not.toHaveProperty('chatroomId');
  });

  test('throws when a derive field is not a four-segment key', async () => {
    await expect(
      build({
        room: [roomRow()],
        messages: [message('message-1', 10, { terminalHandoffKey: 'not-a-handoff-key' })],
      })
    ).rejects.toThrow(/4-segment/);
  });
});

// ---------------------------------------------------------------------------
// Checksum
// ---------------------------------------------------------------------------

describe('checksum', () => {
  const content = (text: string): ExportRawRow[] => [message('message-1', 10, { content: text })];

  test('changes when content changes and not when only exportedAt changes', async () => {
    const first = await build({ room: [roomRow()], messages: content('one') });
    const later = await build(
      { room: [roomRow()], messages: content('one') },
      {
        exportedAt: '2026-02-02T00:00:00.000Z',
      }
    );
    const changed = await build({ room: [roomRow()], messages: content('two') });

    expect(later.exportedAt).not.toBe(first.exportedAt);
    expect(later.checksum).toBe(first.checksum);
    expect(changed.checksum).not.toBe(first.checksum);
  });

  test('is lowercase hex sha256', async () => {
    const file = await build({ room: [roomRow()] });
    expect(file.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});
