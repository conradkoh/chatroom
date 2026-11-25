/**
 * Chatroom transfer registry.
 *
 * This module is the single source of truth for what a chatroom export carries,
 * what an import rebuilds, and what is deliberately left behind. The companion
 * spec walks `convex/schema.ts` and fails when a chatroom- or workspace-keyed
 * table, or a field of an exported table, has no decision here.
 *
 * ## Classification
 *
 * - `exported` — content copied into the file, with a per-field rule.
 * - `rebuilt` — derived data the import regenerates from exported content.
 * - `excluded` — runtime, per-user, credential, binary or deprecated data.
 *
 * `keyedBy` names the key shape that groups the table (`chatroomId`,
 * `workspaceId`, `machine+workingDir`, `root`, `parent-id`). Families group
 * tables that share one decision and one omitted-manifest key.
 *
 * ## Rollback
 *
 * Every exported table and every table the import writes has a rollback
 * descriptor so a failed import can delete its rows without scanning. The
 * `take` descriptors are exercised against an empty database by the spec, which
 * proves each `(table, index)` pair exists at runtime.
 */

import type { Id, TableNames } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import type { ExportCategory } from '../../entities/chatroom-transfer-file';

export type FieldRule =
  | { rule: 'copy' } // verbatim
  | { rule: 'ref'; table: string } // Id → key on export; key → new Id on import
  | { rule: 'reset'; note: string } // exported verbatim, import overrides
  | { rule: 'rebind'; note: string } // machineId → target; file keeps sourceMachineId
  | { rule: 'derive'; note: string } // terminalHandoffKey ↔ terminalHandoffRole
  | { rule: 'system'; note: string } // set by the server
  | { rule: 'drop'; reason: string }; // not exported

export type Keyed = 'chatroomId' | 'workspaceId' | 'machine+workingDir' | 'root' | 'parent-id';

export interface RollbackDescriptor {
  /** Index whose leading field is chatroomId (or ownerId for the cursor table). */
  index: string;
  cost: 1 | 30;
  take: (
    ctx: MutationCtx,
    key: { chatroomId: Id<'chatroom_rooms'>; ownerId: Id<'users'> },
    limit: number
  ) => Promise<{ _id: string }[]>;
}

interface Base {
  keyedBy: Keyed;
  reason: string;
  rollback?: RollbackDescriptor;
}

export type ExportedEntry = Base & {
  classification: 'exported';
  category: ExportCategory;
  stability: 'append-only' | 'mutable';
  fields: Record<string, FieldRule>;
  read: (ctx: QueryCtx, chatroomId: Id<'chatroom_rooms'>) => unknown;
  cost: 1 | 30;
};

export type RebuiltEntry = Base & { classification: 'rebuilt'; rebuiltBy: string };

export type ExcludedEntry = Base & { classification: 'excluded' };

export type TransferEntry = ExportedEntry | RebuiltEntry | ExcludedEntry;

export type TransferFamily =
  | {
      members: string[];
      keyedBy: Keyed;
      reason: string;
      classification: 'rebuilt';
      rebuiltBy: string;
    }
  | {
      members: string[];
      keyedBy: Keyed;
      reason: string;
      classification: 'excluded';
    };

interface IndexRangeBuilder {
  eq: (field: string, value: unknown) => IndexRangeBuilder;
}

interface ChatroomQuery {
  withIndex: (
    indexName: string,
    range: (q: IndexRangeBuilder) => IndexRangeBuilder
  ) => {
    take: (limit: number) => Promise<{ _id: string }[]>;
    paginate: (opts: { numItems: number; cursor: string | null }) => Promise<unknown>;
  };
}

type RangeBuilder = (
  q: IndexRangeBuilder,
  key: { chatroomId: Id<'chatroom_rooms'>; ownerId?: Id<'users'> }
) => IndexRangeBuilder;

/**
 * Builds a read or rollback query over `(chatroomId, …)` using a named index.
 *
 * This is the only place with the `as never` cast for a runtime index name: the
 * generated index union cannot be expressed statically. The spec calls every
 * descriptor against an empty database, so a typo throws instead of silently
 * reading nothing.
 */
function byChatroom(
  table: TableNames,
  index: string,
  range: RangeBuilder = (q, key) => q.eq('chatroomId', key.chatroomId)
) {
  const query = (ctx: QueryCtx, key: { chatroomId: Id<'chatroom_rooms'>; ownerId?: Id<'users'> }) =>
    (ctx.db.query(table) as never as ChatroomQuery).withIndex(index, (q) => range(q, key));

  return {
    read: (ctx: QueryCtx, chatroomId: Id<'chatroom_rooms'>) => query(ctx, { chatroomId }),
    rollback: (cost: 1 | 30): RollbackDescriptor => ({
      index,
      cost,
      take: (ctx, key, limit) => query(ctx, key).take(limit),
    }),
  };
}

const dropDeprecated = (reason: string): FieldRule => ({ rule: 'drop', reason });

/** Exported chatroom content, in dependency order. */
export const CHATROOM_SCOPED_TABLES: Readonly<Record<string, TransferEntry>> = {
  chatroom_rooms: {
    classification: 'exported',
    category: 'room',
    keyedBy: 'root',
    stability: 'mutable',
    reason: 'The chatroom root row is the export anchor.',
    cost: 1,
    read: (ctx, chatroomId) => ctx.db.get('chatroom_rooms', chatroomId),
    rollback: {
      index: '',
      cost: 1,
      take: async (ctx, key) => {
        const row = await ctx.db.get('chatroom_rooms', key.chatroomId);
        return row ? [{ _id: row._id }] : [];
      },
    },
    fields: {
      status: { rule: 'copy' },
      name: { rule: 'copy' },
      lastActivityAt: { rule: 'copy' },
      nextQueuePosition: { rule: 'copy' },
      standingInstructions: { rule: 'copy' },
      standingInstructionsEnabled: { rule: 'copy' },
      standingInstructionsTitle: { rule: 'copy' },
      ownerId: { rule: 'system', note: 'Assigned to the importing user.' },
      teamId: dropDeprecated('Deprecated; team structure moved to chatroom_activeTeamStructures.'),
      teamName: dropDeprecated(
        'Deprecated; team structure moved to chatroom_activeTeamStructures.'
      ),
      teamRoles: dropDeprecated(
        'Deprecated; team structure moved to chatroom_activeTeamStructures.'
      ),
      teamEntryPoint: dropDeprecated(
        'Deprecated; team structure moved to chatroom_activeTeamStructures.'
      ),
      currentContextId: dropDeprecated('Deprecated; context creation was removed.'),
      messageCount: dropDeprecated('Deprecated; message counts are derived at read time.'),
    },
  },
  chatroom_activeTeamStructures: {
    classification: 'exported',
    category: 'room',
    keyedBy: 'chatroomId',
    stability: 'mutable',
    reason: 'The room-specific team selection is restored on import.',
    cost: 1,
    read: byChatroom('chatroom_activeTeamStructures', 'by_chatroom').read,
    rollback: byChatroom('chatroom_activeTeamStructures', 'by_chatroom').rollback(1),
    fields: {
      teamStructureId: { rule: 'copy' },
      chatroomId: { rule: 'system', note: 'Assigned to the imported chatroom.' },
      updatedBy: { rule: 'system', note: 'Assigned to the importing user.' },
      createdAt: dropDeprecated('Server clock; recreated on import.'),
      updatedAt: dropDeprecated('Server clock; recreated on import.'),
    },
  },
  chatroom_workspaces: {
    classification: 'exported',
    category: 'workspaces',
    keyedBy: 'chatroomId',
    stability: 'mutable',
    reason: 'Workspace mappings are rebound to the target machine on import.',
    cost: 1,
    read: byChatroom('chatroom_workspaces', 'by_chatroom').read,
    rollback: byChatroom('chatroom_workspaces', 'by_chatroom').rollback(1),
    fields: {
      workingDir: { rule: 'copy' },
      fileTreeSyncEnabled: { rule: 'copy' },
      machineId: {
        rule: 'rebind',
        note: 'Rebound to the target machine; the file keeps sourceMachineId.',
      },
      chatroomId: { rule: 'system', note: 'Assigned to the imported chatroom.' },
      hostname: dropDeprecated('Source-machine detail; the target machine supplies its own.'),
      registeredAt: dropDeprecated('Server clock; recreated on import.'),
      registeredBy: dropDeprecated('Source registration detail; not portable.'),
      removedAt: dropDeprecated('Removed workspaces are not carried.'),
    },
  },
  chatroom_primaryWorkspaces: {
    classification: 'exported',
    category: 'room',
    keyedBy: 'chatroomId',
    stability: 'mutable',
    reason: 'The primary-workspace pointer is restored after workspaces.',
    cost: 1,
    read: byChatroom('chatroom_primaryWorkspaces', 'by_chatroom').read,
    rollback: byChatroom('chatroom_primaryWorkspaces', 'by_chatroom').rollback(1),
    fields: {
      workspaceId: { rule: 'ref', table: 'chatroom_workspaces' },
      chatroomId: { rule: 'system', note: 'Assigned to the imported chatroom.' },
      updatedAt: dropDeprecated('Server clock; recreated on import.'),
    },
  },
  chatroom_agentLastSentLaunchRequests: {
    classification: 'exported',
    category: 'agentConfigs',
    keyedBy: 'chatroomId',
    stability: 'mutable',
    reason: 'The last launch sent for each role is restored as configuration history.',
    cost: 1,
    read: byChatroom('chatroom_agentLastSentLaunchRequests', 'by_chatroom').read,
    rollback: byChatroom('chatroom_agentLastSentLaunchRequests', 'by_chatroom').rollback(1),
    fields: {
      role: { rule: 'copy' },
      agentType: { rule: 'copy' },
      agentHarness: { rule: 'copy' },
      model: { rule: 'copy' },
      workingDir: { rule: 'copy' },
      workspaceId: { rule: 'ref', table: 'chatroom_workspaces' },
      machineId: {
        rule: 'rebind',
        note: 'Rebound to the target machine; the file keeps sourceMachineId.',
      },
      chatroomId: { rule: 'system', note: 'Assigned to the imported chatroom.' },
      requestKey: dropDeprecated('Request identity is scoped to the source deployment.'),
      requestId: dropDeprecated('Request identity is scoped to the source deployment.'),
      commandId: dropDeprecated('Command identity is scoped to the source deployment.'),
      teamStructureId: dropDeprecated('Team structure is restored from the room entry.'),
      reason: dropDeprecated('Launch reason describes the source request, not the import.'),
      wantResume: dropDeprecated('Resume intent is not portable.'),
      requestedBy: dropDeprecated('Source user id is not portable.'),
      requestedAt: dropDeprecated('Server clock; recreated on import.'),
    },
  },
  chatroom_messages: {
    classification: 'exported',
    category: 'messages',
    keyedBy: 'chatroomId',
    stability: 'append-only',
    reason: 'Message history is the core of the export.',
    read: byChatroom('chatroom_messages', 'by_chatroom').read,
    rollback: byChatroom('chatroom_messages', 'by_chatroom').rollback(30),
    cost: 30,
    fields: {
      senderRole: { rule: 'copy' },
      content: { rule: 'copy' },
      targetRole: { rule: 'copy' },
      claimedByRole: { rule: 'copy' },
      sourcePlatform: { rule: 'copy' },
      type: { rule: 'copy' },
      contextCreatedBy: { rule: 'copy' },
      classification: { rule: 'copy' },
      featureTitle: { rule: 'copy' },
      featureDescription: { rule: 'copy' },
      featureTechSpecs: { rule: 'copy' },
      enhancerOriginalContent: { rule: 'copy' },
      enhancerJobId: { rule: 'copy' },
      visibleInAllTabOnly: { rule: 'copy' },
      attachedSnippets: { rule: 'copy' },
      senderAgent: { rule: 'copy' },
      acknowledgedAt: { rule: 'copy' },
      completedAt: { rule: 'copy' },
      supersedesPlanId: { rule: 'ref', table: 'chatroom_messages' },
      taskOriginMessageId: { rule: 'ref', table: 'chatroom_messages' },
      attachedMessageIds: { rule: 'ref', table: 'chatroom_messages' },
      taskId: { rule: 'ref', table: 'chatroom_tasks' },
      attachedTaskIds: { rule: 'ref', table: 'chatroom_tasks' },
      attachedBacklogItemIds: { rule: 'ref', table: 'chatroom_backlog' },
      attachedArtifactIds: { rule: 'ref', table: 'chatroom_artifacts' },
      scheduledPromptId: { rule: 'ref', table: 'chatroom_scheduledPrompts' },
      terminalHandoffKey: {
        rule: 'derive',
        note: 'Exported as terminalHandoffRole and recomputed from the imported role.',
      },
      chatroomId: { rule: 'system', note: 'Assigned to the imported chatroom.' },
      attachedFileIds: {
        rule: 'drop',
        reason: 'Attachments are refused before export; non-empty values never reach the file.',
      },
      attachedWorkflowIds: dropDeprecated('Deprecated workflow attachments are not carried.'),
    },
  },
  chatroom_messageQueue: {
    classification: 'exported',
    category: 'messageQueue',
    keyedBy: 'chatroomId',
    stability: 'mutable',
    reason: 'Queued messages are restored so the room resumes where it stopped.',
    cost: 1,
    read: byChatroom('chatroom_messageQueue', 'by_chatroom').read,
    rollback: byChatroom('chatroom_messageQueue', 'by_chatroom').rollback(1),
    fields: {
      senderRole: { rule: 'copy' },
      targetRole: { rule: 'copy' },
      content: { rule: 'copy' },
      type: { rule: 'copy' },
      sourcePlatform: { rule: 'copy' },
      attachedSnippets: { rule: 'copy' },
      queuePosition: { rule: 'copy' },
      plannerEnhancerEnabled: { rule: 'copy' },
      conversationMode: { rule: 'copy' },
      startInNewSession: { rule: 'copy' },
      taskEnvelope: { rule: 'copy' },
      attachedTaskIds: { rule: 'ref', table: 'chatroom_tasks' },
      attachedBacklogItemIds: { rule: 'ref', table: 'chatroom_backlog' },
      attachedArtifactIds: { rule: 'ref', table: 'chatroom_artifacts' },
      attachedMessageIds: { rule: 'ref', table: 'chatroom_messages' },
      scheduledPromptId: { rule: 'ref', table: 'chatroom_scheduledPrompts' },
      attachedWorkflowIds: dropDeprecated('Deprecated workflow attachments are not carried.'),
      chatroomId: { rule: 'system', note: 'Assigned to the imported chatroom.' },
    },
  },
  chatroom_tasks: {
    classification: 'exported',
    category: 'tasks',
    keyedBy: 'chatroomId',
    stability: 'mutable',
    reason: 'Task history is exported; active delivery state is reset.',
    read: byChatroom('chatroom_tasks', 'by_chatroom').read,
    rollback: byChatroom('chatroom_tasks', 'by_chatroom').rollback(30),
    cost: 30,
    fields: {
      createdBy: { rule: 'copy' },
      content: { rule: 'copy' },
      assignedTo: { rule: 'copy' },
      queuePosition: { rule: 'copy' },
      createdAt: { rule: 'copy' },
      updatedAt: { rule: 'copy' },
      completedAt: { rule: 'copy' },
      origin: { rule: 'copy' },
      complexity: { rule: 'copy' },
      value: { rule: 'copy' },
      priority: { rule: 'copy' },
      plannerEnhancerEnabled: { rule: 'copy' },
      conversationMode: { rule: 'copy' },
      enhancerEnabledAtEnqueue: { rule: 'copy' },
      startInNewSession: { rule: 'copy' },
      taskEnvelope: { rule: 'copy' },
      status: {
        rule: 'reset',
        note: 'Non-terminal tasks return to pending; terminal statuses are kept.',
      },
      acknowledgedAt: { rule: 'reset', note: 'Cleared; no participant has acknowledged it yet.' },
      startedAt: { rule: 'reset', note: 'Cleared; no participant has started it yet.' },
      deliveryFailure: { rule: 'reset', note: 'Cleared; delivery starts fresh.' },
      sessionPolicyConsumedAt: {
        rule: 'reset',
        note: 'Cleared; the session policy is unconsumed.',
      },
      sourceMessageId: { rule: 'ref', table: 'chatroom_messages' },
      originUserMessageId: { rule: 'ref', table: 'chatroom_messages' },
      attachedTaskIds: { rule: 'ref', table: 'chatroom_tasks' },
      parentTaskIds: { rule: 'ref', table: 'chatroom_tasks' },
      chatroomId: { rule: 'system', note: 'Assigned to the imported chatroom.' },
    },
  },
  chatroom_backlog: {
    classification: 'exported',
    category: 'backlog',
    keyedBy: 'chatroomId',
    stability: 'mutable',
    reason: 'Backlog items are exported; deleted rows are filtered and counted.',
    cost: 1,
    read: byChatroom('chatroom_backlog', 'by_chatroom').read,
    rollback: byChatroom('chatroom_backlog', 'by_chatroom').rollback(1),
    fields: {
      createdBy: { rule: 'copy' },
      content: { rule: 'copy' },
      status: { rule: 'copy' },
      createdAt: { rule: 'copy' },
      updatedAt: { rule: 'copy' },
      completedAt: { rule: 'copy' },
      complexity: { rule: 'copy' },
      value: { rule: 'copy' },
      priority: { rule: 'copy' },
      closeReason: { rule: 'copy' },
      assignedTo: dropDeprecated('D9: backlog items are unassigned in the target room.'),
      legacyTaskId: dropDeprecated('Deprecated legacy task link.'),
      chatroomId: { rule: 'system', note: 'Assigned to the imported chatroom.' },
    },
  },
  chatroom_artifacts: {
    classification: 'exported',
    category: 'artifacts',
    keyedBy: 'chatroomId',
    stability: 'append-only',
    reason: 'Artifact versions are exported with their version links.',
    read: byChatroom('chatroom_artifacts', 'by_chatroom').read,
    rollback: byChatroom('chatroom_artifacts', 'by_chatroom').rollback(30),
    cost: 30,
    fields: {
      artifactGroupId: { rule: 'copy' },
      filename: { rule: 'copy' },
      description: { rule: 'copy' },
      mimeType: { rule: 'copy' },
      content: { rule: 'copy' },
      version: { rule: 'copy' },
      isLatest: { rule: 'copy' },
      createdBy: { rule: 'copy' },
      createdAt: { rule: 'copy' },
      previousVersionId: { rule: 'ref', table: 'chatroom_artifacts' },
      chatroomId: { rule: 'system', note: 'Assigned to the imported chatroom.' },
    },
  },
  chatroom_contexts: {
    classification: 'exported',
    category: 'contexts',
    keyedBy: 'chatroomId',
    stability: 'append-only',
    reason: 'Context snapshots are exported for history.',
    cost: 1,
    read: byChatroom('chatroom_contexts', 'by_chatroom').read,
    rollback: byChatroom('chatroom_contexts', 'by_chatroom').rollback(1),
    fields: {
      content: { rule: 'copy' },
      createdBy: { rule: 'copy' },
      createdAt: { rule: 'copy' },
      messageCountAtCreation: { rule: 'copy' },
      triggerMessageId: { rule: 'ref', table: 'chatroom_messages' },
      chatroomId: { rule: 'system', note: 'Assigned to the imported chatroom.' },
    },
  },
  chatroom_scheduledPrompts: {
    classification: 'exported',
    category: 'scheduledPrompts',
    keyedBy: 'chatroomId',
    stability: 'mutable',
    reason: 'Scheduled prompts are exported paused; the scheduler rebuilds nextRunAt.',
    cost: 1,
    read: byChatroom('chatroom_scheduledPrompts', 'by_chatroom').read,
    rollback: byChatroom('chatroom_scheduledPrompts', 'by_chatroom').rollback(1),
    fields: {
      name: { rule: 'copy' },
      prompt: { rule: 'copy' },
      scheduleKind: { rule: 'copy' },
      intervalMinutes: { rule: 'copy' },
      hourUTC: { rule: 'copy' },
      minuteUTC: { rule: 'copy' },
      runAt: { rule: 'copy' },
      taskEnvelope: { rule: 'copy' },
      lastRunAt: { rule: 'copy' },
      createdAt: { rule: 'copy' },
      updatedAt: { rule: 'copy' },
      isRunnable: { rule: 'reset', note: 'Import writes false so nothing fires before review.' },
      disabledReason: {
        rule: 'reset',
        note: 'Kept only when the source prompt was completed or failed.',
      },
      nextRunAt: dropDeprecated('Derived by the scheduler from the schedule fields.'),
      chatroomId: { rule: 'system', note: 'Assigned to the imported chatroom.' },
      createdBy: { rule: 'system', note: 'Assigned to the importing user.' },
    },
  },
  chatroom_savedCommands: {
    classification: 'exported',
    category: 'savedCommands',
    keyedBy: 'chatroomId',
    stability: 'mutable',
    reason: 'Chatroom-scoped saved commands are exported; user-scoped ones are not.',
    cost: 1,
    read: byChatroom('chatroom_savedCommands', 'by_chatroom_scope', (q, key) =>
      q.eq('chatroomId', key.chatroomId).eq('scope', 'chatroom')
    ).read,
    rollback: byChatroom('chatroom_savedCommands', 'by_chatroom').rollback(1),
    fields: {
      type: { rule: 'copy' },
      scope: { rule: 'copy' },
      name: { rule: 'copy' },
      prompt: { rule: 'copy' },
      createdBy: { rule: 'copy' },
      createdAt: { rule: 'copy' },
      updatedAt: { rule: 'copy' },
      ownerId: dropDeprecated('User-owned commands are per-user data.'),
      chatroomId: { rule: 'system', note: 'Assigned to the imported chatroom.' },
    },
  },
  chatroom_skillCustomizations: {
    classification: 'exported',
    category: 'skillCustomizations',
    keyedBy: 'chatroomId',
    stability: 'mutable',
    reason: 'Chatroom skill customizations are exported; their source links are dropped.',
    cost: 1,
    read: byChatroom('chatroom_skillCustomizations', 'by_chatroomId').read,
    rollback: byChatroom('chatroom_skillCustomizations', 'by_chatroomId').rollback(1),
    fields: {
      type: { rule: 'copy' },
      name: { rule: 'copy' },
      content: { rule: 'copy' },
      isEnabled: { rule: 'copy' },
      createdAt: { rule: 'copy' },
      updatedAt: { rule: 'copy' },
      chatroomId: { rule: 'system', note: 'Assigned to the imported chatroom.' },
      ownerId: { rule: 'system', note: 'Assigned to the importing user.' },
      sourceChatroomId: dropDeprecated('Source chatroom link is not portable.'),
      sourceCustomizationId: dropDeprecated('Source customization link is not portable.'),
    },
  },

  // ── Rebuilt read models ────────────────────────────────────────────────
  chatroom_messageReadModels: {
    classification: 'rebuilt',
    keyedBy: 'chatroomId',
    reason: 'Read models are derived from imported messages.',
    rebuiltBy: 'insertChatroomMessage / syncMessageReadModel',
    rollback: byChatroom('chatroom_messageReadModels', 'by_chatroom_createdAt').rollback(30),
  },
  chatroom_messageReadModelState: {
    classification: 'rebuilt',
    keyedBy: 'chatroomId',
    reason: 'Read-model counters are derived from imported messages.',
    rebuiltBy: 'insertChatroomWithTeam',
    rollback: byChatroom('chatroom_messageReadModelState', 'by_chatroom').rollback(1),
  },
  chatroom_taskCounts: {
    classification: 'rebuilt',
    keyedBy: 'chatroomId',
    reason: 'Task counts are derived from imported tasks.',
    rebuiltBy: 'adjustTaskCount',
    rollback: byChatroom('chatroom_taskCounts', 'by_chatroom').rollback(1),
  },
  chatroom_activeTaskHeaders: {
    classification: 'rebuilt',
    keyedBy: 'chatroomId',
    reason: 'Active task headers are derived from imported task state.',
    rebuiltBy: 'syncActiveTaskHeader',
    rollback: byChatroom('chatroom_activeTaskHeaders', 'by_chatroom').rollback(30),
  },
  chatroom_timelineTaskStatusSignals: {
    classification: 'rebuilt',
    keyedBy: 'chatroomId',
    reason: 'Timeline signals are derived from imported task state.',
    rebuiltBy: 'writeTaskStatusSignals',
    rollback: byChatroom('chatroom_timelineTaskStatusSignals', 'by_chatroom_signalKey').rollback(
      30
    ),
  },
  chatroom_unreadStatus: {
    classification: 'rebuilt',
    keyedBy: 'chatroomId',
    reason: 'Unread markers are per-user runtime state.',
    rebuiltBy: 'none written by import; absence means read',
  },
  chatroom_agentRoleStatusReadModel: {
    classification: 'rebuilt',
    keyedBy: 'chatroomId',
    reason: 'Agent status is a daemon projection of live processes.',
    rebuiltBy: 'daemon lifecycle projection (empty until an agent runs)',
  },
  chatroom_fileStorageUsage: {
    classification: 'rebuilt',
    keyedBy: 'chatroomId',
    reason: 'Storage usage is per-user runtime accounting.',
    rebuiltBy: 'no rows: attachments refused',
  },

  // ── Excluded runtime state ─────────────────────────────────────────────
  chatroom_participants: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Live connection state; participants rejoin the imported room.',
  },
  chatroom_connectionCloseRequests: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Live connection control messages; not portable.',
  },
  chatroom_agentRuntimeStates: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Live agent process state; rebuilt by the daemon on the target machine.',
  },
  chatroom_agentRestartMetrics: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Runtime restart telemetry; not portable.',
  },
  chatroom_agentDesiredConfigs: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Deprecated desired-config rows; replaced by launch requests.',
  },
  chatroom_observation: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Runtime observation timestamps; rebuilt by the daemon.',
  },
  chatroom_machineObservedWorkspaceViews: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Runtime machine observation; rebuilt by the daemon.',
  },
  chatroom_taskDeliveryReceipts: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Delivery receipts describe the source run; not portable.',
  },
  chatroom_skillActivations: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Runtime skill activation log; not portable.',
  },
  chatroom_capabilities_refresh_batches: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Runtime capability-refresh bookkeeping; not portable.',
  },
  chatroom_capabilities_refresh_machine_results: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Runtime capability-refresh bookkeeping; not portable.',
  },
  chatroomWorkspaceTaskInbox: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Machine inbox events are runtime delivery state.',
  },
  chatroomWorkspaceAgentConfigInbox: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Machine inbox events are runtime delivery state.',
    rollback: byChatroom('chatroomWorkspaceAgentConfigInbox', 'by_chatroom_role').rollback(1),
  },

  // ── Excluded per-user state ────────────────────────────────────────────
  chatroom_favorites: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Per-user favorites; the importing user starts fresh.',
  },
  chatroom_conversationModePreferences: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Per-user conversation mode preference.',
  },
  chatroom_read_cursors: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Per-user read position; absence means unread.',
    rollback: byChatroom('chatroom_read_cursors', 'by_userId_chatroomId', (q, key) =>
      q.eq('userId', key.ownerId).eq('chatroomId', key.chatroomId)
    ).rollback(1),
  },

  // ── Excluded sensitive or non-content data ─────────────────────────────
  chatroom_integrations: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Integration credentials (bot tokens) are never exported.',
  },
  chatroom_fileAttachments: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Binary attachments are refused before export.',
  },
  chatroom_fileStorageSettings: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Chatroom storage policy; not content.',
  },
  chatroom_workflows: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Deprecated workflow feature.',
  },
  chatroom_workflow_steps: {
    classification: 'excluded',
    keyedBy: 'chatroomId',
    reason: 'Deprecated workflow feature.',
  },
};

/** Families group tables that share one decision and one omitted-manifest key. */
export const CHATROOM_SCOPED_FAMILIES: Readonly<Record<string, TransferFamily>> = {
  workspace_caches: {
    classification: 'rebuilt',
    keyedBy: 'machine+workingDir',
    reason: 'Workspace caches are rebuilt by the target daemon.',
    rebuiltBy: 'daemon refresh nudged by registerWorkspace',
    members: [
      'chatroom_workspaceGitState',
      'chatroom_workspaceGitHead',
      'chatroom_workspaceGitWorktree',
      'chatroom_workspaceGitUpstream',
      'chatroom_workspaceGitRemotes',
      'chatroom_workspaceGitPullRequests',
      'chatroom_workspaceGitChecks',
      'chatroom_workspaceFullDiff',
      'chatroom_workspacePRDiffs',
      'chatroom_workspacePRCommits',
      'chatroom_workspaceAllPullRequests',
      'chatroom_workspaceRecentCommits',
      'chatroom_workspaceCommitDetail',
      'chatroom_workspaceFileTree',
      'chatroom_workspaceFileContent',
      'chatroom_workspaceFileTreeV2',
      'chatroom_workspaceFileTreeShardV3',
      'chatroom_workspaceFileTreeManifestV3',
      'chatroom_workspaceFileTreeCheckpointV2',
      'chatroom_workspaceFileTreeDelta',
      'chatroom_workspaceFileTreeDeltaOperation',
      'chatroom_workspaceDirListingV2',
      'chatroom_workspaceFileSearchV2',
      'chatroom_workspaceFullDiffV2',
      'chatroom_workspaceCommitDetailV2',
      'chatroom_workspaceFileContentV2',
    ],
  },
  workspace_requests: {
    classification: 'excluded',
    keyedBy: 'machine+workingDir',
    reason: 'In-flight workspace requests belong to the source daemon.',
    members: [
      'chatroom_workspaceFileContentRequests',
      'chatroom_workspaceFileWriteRequests',
      'chatroom_workspaceFileTreeRequests',
      'chatroom_workspaceFileTreeWatches',
      'chatroom_workspaceFileTreeReleaseRequests',
      'chatroom_workspaceDirListingRequests',
      'chatroom_workspaceDirListingWatch',
      'chatroom_workspaceFileSearchRequests',
      'chatroom_workspaceDiffRequests',
    ],
  },
  command_runner: {
    classification: 'excluded',
    keyedBy: 'machine+workingDir',
    reason: 'Command runner state is machine-local.',
    members: ['chatroom_runnableCommands', 'chatroom_commandRunsV2'],
  },
  agentic_query_history: {
    classification: 'excluded',
    keyedBy: 'parent-id',
    reason: 'User search and ask history is not carried in this PR (disclosed gap).',
    members: [
      'chatroom_agenticQueries',
      'chatroom_agenticQueryTurns',
      'chatroom_agenticQueryRuns',
      'chatroom_agenticQueryRunTurns',
      'chatroom_agenticQueryRunMessages',
    ],
  },
};

/** Omission categories the export build counts (it fills the counts; the registry reports null). */
const COUNTED_OMISSIONS: Record<string, string> = {
  workspaceRemovals: 'Workspaces removed before export are not carried.',
  backlogDeleted: 'Backlog rows with status deleted are filtered out and counted.',
  launchRequestsOtherTeam: 'Launch requests for other teams are filtered out and counted.',
  attachedWorkflows: 'Deprecated workflow attachments are not carried.',
};

type Omission = { count: number | null; reason: string };

const omission = (reason: string): Omission => ({ count: null, reason });

const COUNTED_OMISSIONS_MANIFEST: Record<string, Omission> = Object.fromEntries(
  Object.entries(COUNTED_OMISSIONS).map(([name, reason]) => [name, omission(reason)])
);

function entryOmissions(): Record<string, Omission> {
  return Object.fromEntries(
    Object.entries(CHATROOM_SCOPED_TABLES)
      .filter(([, entry]) => entry.classification !== 'exported')
      .map(([name, entry]) => [name, omission(entry.reason)])
  );
}

function familyOmissions(): Record<string, Omission> {
  return Object.fromEntries(
    Object.entries(CHATROOM_SCOPED_FAMILIES).map(([name, family]) => [
      name,
      omission(family.reason),
    ])
  );
}

/** One key per non-exported entry or family, plus the counted row filters. */
export function omittedManifest(): Record<string, Omission> {
  return { ...entryOmissions(), ...familyOmissions(), ...COUNTED_OMISSIONS_MANIFEST };
}

/** Exported entries only, in dependency order. */
export function exportedEntries(): ExportedEntry[] {
  return Object.values(CHATROOM_SCOPED_TABLES).filter(
    (entry): entry is ExportedEntry => entry.classification === 'exported'
  );
}

/**
 * Rollback order: children first, `chatroom_rooms` last.
 * Only tables with a rollback descriptor appear.
 */
export const ROLLBACK_ORDER: string[] = [
  'chatroom_messageReadModels',
  'chatroom_messageReadModelState',
  'chatroom_timelineTaskStatusSignals',
  'chatroom_activeTaskHeaders',
  'chatroom_taskCounts',
  'chatroom_messageQueue',
  'chatroom_tasks',
  'chatroom_messages',
  'chatroom_artifacts',
  'chatroom_contexts',
  'chatroom_backlog',
  'chatroom_scheduledPrompts',
  'chatroom_savedCommands',
  'chatroom_skillCustomizations',
  'chatroom_agentLastSentLaunchRequests',
  'chatroomWorkspaceAgentConfigInbox',
  'chatroom_primaryWorkspaces',
  'chatroom_workspaces',
  'chatroom_activeTeamStructures',
  'chatroom_read_cursors',
  'chatroom_rooms',
];
