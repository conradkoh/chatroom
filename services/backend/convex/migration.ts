/**
 * Database Migrations
 *
 * Internal mutations and actions for one-off data migrations.
 * Run from the Convex dashboard as internal functions.
 *
 * Migrations are NOT run automatically by CI — they must be triggered manually
 * from the Convex dashboard after deploying. All migrations are idempotent and
 * safe to re-run.
 *
 * Previously executed migrations (removed after completion):
 * - Session expiration field removal (deprecated expiresAt/expiresAtLabel)
 * - User access level defaults (set undefined → 'user')
 * - Task origin normalization (set undefined → 'chat'/'backlog')
 * - Tool → Harness field rename (availableTools → availableHarnesses, etc.)
 * - Convert backlog_acknowledged task status to backlog (migrateBacklogAcknowledgedToBacklog)
 * - Move backlog items from chatroom_tasks to chatroom_backlog (migrateBacklogItemsToBacklogTable)
 */

import { internalMutation } from './_generated/server';

// ============================================================================
// PENDING MIGRATIONS — Run these after deploying to production
// ============================================================================

/**
 * Migration: Convert availableModels from string[] to Record<string, string[]>.
 *
 * The schema changed availableModels from a flat `string[]` to a per-harness
 * record `{ opencode: [...], pi: [...] }`. Existing machine documents written
 * by the old CLI still store a plain array, causing schema validation errors.
 *
 * The schema temporarily accepts both shapes via v.union(...) to allow this
 * migration to run without rejecting old documents. Once this migration has
 * been successfully run in production, do the following cleanup:
 *
 *   1. In schema.ts — revert availableModels back to:
 *        availableModels: v.optional(v.record(v.string(), v.array(v.string())))
 *      (remove the v.union wrapper and the DEPRECATED SHAPE comment)
 *
 *   2. Remove this migration (move description to the "Previously executed" list above).
 *
 * Idempotent: documents already in the record shape are skipped.
 *
 * Run from the Convex dashboard:
 *   internal.migration.migrateAvailableModelsToPerHarness
 */
export const migrateAvailableModelsToPerHarness = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allMachines = await ctx.db.query('chatroom_machines').collect();

    let patched = 0;
    let skipped = 0;

    for (const machine of allMachines) {
      const raw = (machine as Record<string, unknown>).availableModels;

      // Skip if not set
      if (raw === undefined || raw === null) {
        skipped++;
        continue;
      }

      // Skip if already a record (not an array) — idempotent re-run guard
      if (!Array.isArray(raw)) {
        skipped++;
        continue;
      }

      // Convert flat string[] → { opencode: string[] }
      await ctx.db.patch(machine._id, {
        availableModels: { opencode: raw as string[] },
      });
      patched++;
    }

    return {
      total: allMachines.length,
      patched,
      skipped,
    };
  },
});

/**
 * Migration: Strip stale FSM fields from chatroom_participants.
 *
 * Phase 4 removed `status`, `readyUntil`, `activeUntil`, `cleanupDeadline`,
 * and `statusReason` from the schema. Existing documents written by the old
 * CLI still carry these fields, causing Convex schema validation errors.
 *
 * This migration patches each participant document by unsetting the stale
 * fields. Documents without any stale fields are skipped.
 *
 * Idempotent: documents with no stale fields are skipped on re-run.
 *
 * Run from the Convex dashboard:
 *   internal.migration.stripParticipantStaleFields
 */
export const stripParticipantStaleFields = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allParticipants = await ctx.db.query('chatroom_participants').collect();

    const STALE_FIELDS = [
      'status',
      'readyUntil',
      'activeUntil',
      'cleanupDeadline',
      'statusReason',
      'desiredStatus',
      'pendingCommand',
    ] as const;

    let patched = 0;
    let skipped = 0;

    for (const participant of allParticipants) {
      const doc = participant as Record<string, unknown>;
      const staleFieldsPresent = STALE_FIELDS.filter((f) => f in doc);

      if (staleFieldsPresent.length === 0) {
        skipped++;
        continue;
      }

      // Unset only the stale fields — preserves all valid fields including
      // optional ones (connectionId, agentType, lastSeenAt, lastSeenAction,
      // lastSeenTokenAt) without needing to enumerate them explicitly.
      const unsetPatch = Object.fromEntries(
        staleFieldsPresent.map((f) => [f, undefined])
      );
      await ctx.db.patch(participant._id, unsetPatch);
      patched++;
    }

    return {
      total: allParticipants.length,
      patched,
      skipped,
    };
  },
});

/**
 * Migration: Delete old-format chatroom_agentPreferences documents.
 *
 * The chatroom_agentPreferences table was redesigned from a per-chatroom format
 * (with harnessByRole/modelByRole maps) to a per-role format (with agentHarness,
 * role, model as scalar fields). Old documents in production still use the old
 * shape and fail schema validation on deployment.
 *
 * Since agentPreferences are purely UI hints and have no behavioral impact,
 * the safest migration is to delete old-format documents. Users will need to
 * re-save their preferences after the migration (by clicking "Start Agent" again).
 *
 * After this migration has run successfully in production:
 *   1. In schema.ts — restore agentHarness, role, and createdAt to required fields:
 *        role: v.string(),
 *        agentHarness: agentHarnessValidator,
 *        createdAt: v.number(),
 *      (remove the DEPRECATED SHAPE comments and v.optional wrappers)
 *   2. Remove this migration (move description to "Previously executed" list above).
 *
 * Idempotent: documents already in the new format (with agentHarness) are skipped.
 *
 * Run from the Convex dashboard:
 *   internal.migration.deleteOldFormatAgentPreferences
 */
export const deleteOldFormatAgentPreferences = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allPrefs = await ctx.db.query('chatroom_agentPreferences').collect();

    let deleted = 0;
    let skipped = 0;

    for (const pref of allPrefs) {
      // Old format: missing agentHarness (has harnessByRole map instead)
      const raw = pref as Record<string, unknown>;
      if (raw.agentHarness === undefined) {
        await ctx.db.delete('chatroom_agentPreferences', pref._id);
        deleted++;
      } else {
        skipped++;
      }
    }

    return { deleted, skipped, total: allPrefs.length };
  },
});

/**
 * Migration: Delete pre-refactor chatroom_messageQueue documents with legacy `taskId` field.
 *
 * The chatroom_messageQueue schema was refactored to remove the `taskId` back-reference
 * and replace it with `queuePosition` for ordering. Old documents from before the refactor
 * still have `taskId` but lack `queuePosition`, making them impossible to promote properly.
 *
 * Since these documents cannot be properly promoted, the safest migration is to delete them.
 * The user can re-send any messages that were in the queue.
 *
 * Schema cleanup already applied:
 *   - taskId field has been removed from chatroom_messageQueue schema
 *   - queuePosition is now required (v.number(), not optional)
 *
 * After running this migration in production, move its description to
 * the "Previously executed migrations" list and delete the function.
 *
 * Idempotent: documents without `taskId` are skipped.
 *
 * Run from the Convex dashboard:
 *   internal.migration.deleteLegacyMessageQueueDocuments
 */
export const deleteLegacyMessageQueueDocuments = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allQueuedMessages = await ctx.db.query('chatroom_messageQueue').collect();

    let deleted = 0;
    let skipped = 0;

    for (const msg of allQueuedMessages) {
      const raw = msg as Record<string, unknown>;
      // Old format: has taskId (pre-refactor back-reference to chatroom_tasks)
      if (raw.taskId !== undefined) {
        await ctx.db.delete(msg._id);
        deleted++;
      } else {
        skipped++;
      }
    }

    return { deleted, skipped, total: allQueuedMessages.length };
  },
});

/**
 * Migration: Update chatroom_tasks with legacy "queued" status to "pending".
 *
 * The "queued" status was removed from chatroom_tasks in PR #23 (message queue
 * staging table refactor). Existing documents that still have status="queued"
 * cause Convex schema validation to fail at deploy time.
 *
 * After running this migration in production, remove v.literal('queued') from
 * chatroom_tasks.status in schema.ts and deploy again.
 *
 * Idempotent: safe to re-run (only patches documents with status="queued").
 *
 * Run from the Convex dashboard:
 *   internal.migration.migrateQueuedTasks
 */
export const migrateQueuedTasks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allTasks = await ctx.db.query('chatroom_tasks').collect();

    let migrated = 0;
    for (const task of allTasks) {
      const raw = task as Record<string, unknown>;
      if (raw.status === 'queued') {
        await ctx.db.patch(task._id, { status: 'pending' });
        migrated++;
      }
    }

    return { migrated };
  },
});

/**
 * Migration: Add teamId to teamRoleKey in chatroom_teamAgentConfigs.
 *
 * Old format: chatroom_<chatroomId>#role_<role>
 * New format: chatroom_<chatroomId>#team_<teamId>#role_<role>
 *
 * Including teamId in the key ensures that agent configs are scoped to a specific
 * team structure. When a chatroom switches teams, the new teamRoleKey format prevents
 * stale configs from being reused under a different team's role semantics.
 *
 * Behavior:
 *   - Records already in new format (containing '#team_') are skipped (idempotent)
 *   - Records whose chatroom no longer exists → deleted (orphaned)
 *   - Records whose chatroom has no teamId → deleted (invalid; teamId is required at creation)
 *   - All other records → patched with the new teamRoleKey
 *
 * Run from the Convex dashboard:
 *   internal.migration.migrateTeamRoleKeyAddTeamId
 */
export const migrateTeamRoleKeyAddTeamId = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allConfigs = await ctx.db.query('chatroom_teamAgentConfigs').collect();

    let skipped = 0;
    let migrated = 0;
    let deleted = 0;
    let deduped = 0;
    const seenKeys = new Set<string>();

    for (const config of allConfigs) {
      if (config.teamRoleKey.includes('#team_')) {
        // Already in new format — check for duplicates among migrated records
        if (seenKeys.has(config.teamRoleKey)) {
          await ctx.db.delete('chatroom_teamAgentConfigs', config._id);
          deduped++;
        } else {
          seenKeys.add(config.teamRoleKey);
          skipped++;
        }
        continue;
      }

      const chatroom = await ctx.db.get(config.chatroomId);

      if (!chatroom || !chatroom.teamId) {
        await ctx.db.delete('chatroom_teamAgentConfigs', config._id);
        deleted++;
        continue;
      }

      const newKey = `chatroom_${config.chatroomId}#team_${chatroom.teamId.toLowerCase()}#role_${config.role.toLowerCase()}`;

      if (seenKeys.has(newKey)) {
        await ctx.db.delete('chatroom_teamAgentConfigs', config._id);
        deduped++;
        continue;
      }

      const existingWithKey = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', newKey))
        .first();

      if (existingWithKey) {
        await ctx.db.delete('chatroom_teamAgentConfigs', config._id);
        deduped++;
        continue;
      }

      await ctx.db.patch('chatroom_teamAgentConfigs', config._id, {
        teamRoleKey: newKey,
      });
      seenKeys.add(newKey);
      migrated++;
    }

    return { migrated, skipped, deleted, deduped };
  },
});

/**
 * Migration: Rename stopReason values to actor-prefixed convention.
 *
 * The StopReason type was renamed from underscore_case to actor.prefixed format:
 *   - 'intentional_stop'               → 'user.stop'
 *   - 'daemon_respawn_stop'            → 'daemon.respawn'
 *   - 'process_exited_with_success'    → 'agent_process.exited_clean'
 *   - 'process_terminated_with_signal' → 'agent_process.signal'
 *   - 'process_terminated_unexpectedly' → 'agent_process.crashed'
 *
 * This migration patches all chatroom_eventStream documents where
 * type === 'agent.exited' and stopReason uses an old-format value.
 *
 * Idempotent: documents already using new-format values are skipped on re-run.
 *
 * Run from the Convex dashboard:
 *   internal.migration.migrateStopReasonToActorPrefixed
 */
export const migrateStopReasonToActorPrefixed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const RENAME_MAP: Record<string, string> = {
      intentional_stop: 'user.stop',
      daemon_respawn_stop: 'daemon.respawn',
      process_exited_with_success: 'agent_process.exited_clean',
      process_terminated_with_signal: 'agent_process.signal',
      process_terminated_unexpectedly: 'agent_process.crashed',
    };

    const allEvents = await ctx.db.query('chatroom_eventStream').collect();

    let migrated = 0;
    let skipped = 0;

    for (const event of allEvents) {
      const raw = event as Record<string, unknown>;
      if (raw.type !== 'agent.exited') {
        skipped++;
        continue;
      }

      const oldReason = raw.stopReason as string | undefined;
      if (!oldReason || !(oldReason in RENAME_MAP)) {
        skipped++;
        continue;
      }

      await ctx.db.patch(event._id, { stopReason: RENAME_MAP[oldReason] });
      migrated++;
    }

    return { migrated, skipped, total: allEvents.length };
  },
});

/**
 * Migration: Unify agent start/stop event reason values to actor-prefixed dot notation.
 *
 * Converts persisted event stream reasons from kebab-case to dot notation:
 *
 * agent.requestStop events:
 *   'user-stop'          → 'user.stop'
 *   'dedup-stop'         → 'platform.dedup'
 *   'team-switch'        → 'platform.team_switch'
 *
 * agent.requestStart events:
 *   'user-start'         → 'user.start'
 *   'user-restart'       → 'user.restart'
 *   'ensure-agent-retry' → 'platform.ensure_agent'
 *
 * Idempotent: documents already using new-format values are skipped on re-run.
 *
 * Run from the Convex dashboard:
 *   internal.migration.migrateEventReasonsToActorPrefixed
 */
export const migrateEventReasonsToActorPrefixed = internalMutation({
  args: {},
  handler: async (ctx) => {
    const STOP_REASON_MAP: Record<string, string> = {
      'user-stop': 'user.stop',
      'dedup-stop': 'platform.dedup',
      'team-switch': 'platform.team_switch',
    };

    const START_REASON_MAP: Record<string, string> = {
      'user-start': 'user.start',
      'user-restart': 'user.restart',
    };

    const allEvents = await ctx.db.query('chatroom_eventStream').collect();

    let migrated = 0;
    let skipped = 0;

    for (const event of allEvents) {
      const raw = event as Record<string, unknown>;

      if (raw.type === 'agent.requestStop') {
        const oldReason = raw.reason as string | undefined;
        if (oldReason && oldReason in STOP_REASON_MAP) {
          await ctx.db.patch(event._id, { reason: STOP_REASON_MAP[oldReason] } as never);
          migrated++;
          continue;
        }
      }

      if (raw.type === 'agent.requestStart') {
        const oldReason = raw.reason as string | undefined;
        if (oldReason && oldReason in START_REASON_MAP) {
          await ctx.db.patch(event._id, { reason: START_REASON_MAP[oldReason] } as never);
          migrated++;
          continue;
        }
      }

      skipped++;
    }

    return { migrated, skipped, total: allEvents.length };
  },
});

/**
 * Migration: Deduplicate chatroom_teamAgentConfigs by teamRoleKey.
 *
 * After the teamRoleKey migration, there may be duplicate rows sharing
 * the same teamRoleKey (e.g. from concurrent writes or prior bugs).
 * This migration keeps the most recently updated row per teamRoleKey
 * and deletes the rest.
 *
 * Idempotent: if no duplicates exist, returns { total: N, deduped: 0 }.
 *
 * Run from the Convex dashboard:
 *   internal.migration.deduplicateTeamAgentConfigs
 */
export const deduplicateTeamAgentConfigs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allConfigs = await ctx.db.query('chatroom_teamAgentConfigs').collect();

    const groups = new Map<string, typeof allConfigs>();
    for (const config of allConfigs) {
      const key = config.teamRoleKey;
      const group = groups.get(key);
      if (group) {
        group.push(config);
      } else {
        groups.set(key, [config]);
      }
    }

    let deduped = 0;
    for (const [, group] of groups) {
      if (group.length <= 1) continue;

      group.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));

      for (let i = 1; i < group.length; i++) {
        await ctx.db.delete('chatroom_teamAgentConfigs', group[i]._id);
        deduped++;
      }
    }

    return { total: allConfigs.length, deduped };
  },
});

/**
 * Migration: Purge all rows from chatroom_workspaceCommitDetail.
 *
 * Required before deploying the schema change that adds the `status` discriminated union.
 * Existing rows lack the required `status` field and will fail validation.
 * Safe to run multiple times (idempotent).
 */
export const purgeWorkspaceCommitDetails = internalMutation({
  args: {},
  handler: async (ctx) => {
    const allRows = await ctx.db.query('chatroom_workspaceCommitDetail').collect();
    let deleted = 0;
    for (const row of allRows) {
      await ctx.db.delete('chatroom_workspaceCommitDetail', row._id);
      deleted++;
    }
    return { deleted };
  },
});

/**
 * Migration: Move backlog items from chatroom_tasks to chatroom_backlog.
 *
 * The chatroom_tasks table has records with origin="backlog" that should
 * have been migrated to the chatroom_backlog table. This migration moves
 * them and preserves the old task ID in legacyTaskId for reference mapping.
 *
 * Status mapping (from chatroom_tasks to chatroom_backlog):
 *   - "backlog" → "backlog"
 *   - "pending_user_review" → "pending_user_review"
 *   - "closed" → "closed"
 *   - All other statuses (pending, acknowledged, in_progress, completed,
 *     backlog_acknowledged) → "backlog" (safe default)
 *
 * After running this migration in production:
 *   1. Move this description to "Previously executed migrations" list above.
 *   2. Run remapBacklogTaskIdsInMessages migration to update message references.
 *   3. legacyTaskId can then be safely removed from chatroom_backlog schema.
 *
 * Idempotent: records already migrated (legacyTaskId exists) are skipped.
 *
 * Run from the Convex dashboard:
 *   internal.migration.migrateBacklogItemsToBacklogTable
 */
export const migrateBacklogItemsToBacklogTable = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get all tasks with origin="backlog"
    const allTasks = await ctx.db.query('chatroom_tasks').collect();
    const backlogTasks = allTasks.filter(
      (task) => task.origin === 'backlog'
    );

    let migrated = 0;
    let skipped = 0;

    for (const task of backlogTasks) {
      // Check if already migrated (idempotent check)
      const existing = await ctx.db
        .query('chatroom_backlog')
        .withIndex('by_legacy_task_id', (q) => q.eq('legacyTaskId', task._id))
        .first();

      if (existing) {
        skipped++;
        continue;
      }

      // Map task status to backlog status
      let backlogStatus: 'backlog' | 'pending_user_review' | 'closed';
      if (task.status === 'backlog') {
        backlogStatus = 'backlog';
      } else if (task.status === 'pending_user_review') {
        backlogStatus = 'pending_user_review';
      } else if (task.status === 'closed') {
        backlogStatus = 'closed';
      } else {
        // Default: 'backlog' for all other statuses (pending, acknowledged,
        // in_progress, completed, backlog_acknowledged)
        backlogStatus = 'backlog';
      }

      // Create backlog item
      await ctx.db.insert('chatroom_backlog', {
        chatroomId: task.chatroomId,
        createdBy: task.createdBy,
        content: task.content,
        status: backlogStatus,
        assignedTo: task.assignedTo,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        completedAt: task.completedAt,
        complexity: task.complexity,
        value: task.value,
        priority: task.priority,
        legacyTaskId: task._id,
      });

      migrated++;
    }

    return {
      total: backlogTasks.length,
      migrated,
      skipped,
    };
  },
});

/**
 * Migration: Remap legacy chatroom_tasks IDs in messages to chatroom_backlog IDs.
 *
 * When backlog items were migrated from chatroom_tasks to chatroom_backlog
 * (via migrateBacklogItemsToBacklogTable), the legacyTaskId field was set
 * to preserve the old ID for reference remapping.
 *
 * This migration finds all chatroom_messages and chatroom_messageQueue records
 * that still reference the old chatroom_tasks IDs in their attachedTaskIds field,
 * and moves those references to attachedBacklogItemIds (pointing to the new
 * chatroom_backlog records).
 *
 * Idempotent: records already updated (legacyTaskId no longer in attachedTaskIds)
 * are skipped.
 *
 * After running this migration in production:
 *   1. Move this description to "Previously executed migrations" list.
 *   2. legacyTaskId can then be safely removed from chatroom_backlog schema.
 *   3. Remove deprecated attachedTaskIds and parentTaskIds from chatroom_tasks.
 *
 * Run from the Convex dashboard:
 *   internal.migration.remapBacklogTaskIdsInMessages
 */
export const remapBacklogTaskIdsInMessages = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get all backlog items that have a legacyTaskId
    const backlogItems = await ctx.db
      .query('chatroom_backlog')
      .collect();

    const legacyItems = backlogItems.filter((item) => item.legacyTaskId != null);

    // Build a map: oldTaskId (string) → newBacklogId
    const legacyToNew = new Map(
      legacyItems.map((item) => [item.legacyTaskId!.toString(), item._id])
    );

    let updatedMessages = 0;
    let updatedQueueItems = 0;

    // Process chatroom_messages
    const messages = await ctx.db.query('chatroom_messages').collect();
    for (const msg of messages) {
      if (!msg.attachedTaskIds || msg.attachedTaskIds.length === 0) continue;

      const remainingTaskIds: typeof msg.attachedTaskIds = [];
      const newBacklogIds: typeof msg.attachedBacklogItemIds = [...(msg.attachedBacklogItemIds ?? [])];
      let changed = false;

      for (const taskId of msg.attachedTaskIds) {
        const newId = legacyToNew.get(taskId.toString());
        if (newId) {
          // Don't add duplicates
          if (!newBacklogIds.find((id) => id === newId)) {
            newBacklogIds.push(newId);
          }
          changed = true;
        } else {
          remainingTaskIds.push(taskId);
        }
      }

      if (changed) {
        await ctx.db.patch(msg._id, {
          attachedTaskIds: remainingTaskIds.length > 0 ? remainingTaskIds : undefined,
          attachedBacklogItemIds: newBacklogIds.length > 0 ? newBacklogIds : undefined,
        });
        updatedMessages++;
      }
    }

    // Process chatroom_messageQueue (same logic)
    const queueItems = await ctx.db.query('chatroom_messageQueue').collect();
    for (const item of queueItems) {
      if (!item.attachedTaskIds || item.attachedTaskIds.length === 0) continue;

      const remainingTaskIds: typeof item.attachedTaskIds = [];
      const newBacklogIds: typeof item.attachedBacklogItemIds = [...(item.attachedBacklogItemIds ?? [])];
      let changed = false;

      for (const taskId of item.attachedTaskIds) {
        const newId = legacyToNew.get(taskId.toString());
        if (newId) {
          if (!newBacklogIds.find((id) => id === newId)) {
            newBacklogIds.push(newId);
          }
          changed = true;
        } else {
          remainingTaskIds.push(taskId);
        }
      }

      if (changed) {
        await ctx.db.patch(item._id, {
          attachedTaskIds: remainingTaskIds.length > 0 ? remainingTaskIds : undefined,
          attachedBacklogItemIds: newBacklogIds.length > 0 ? newBacklogIds : undefined,
        });
        updatedQueueItems++;
      }
    }

    return {
      legacyMappings: legacyItems.length,
      updatedMessages,
      updatedQueueItems,
    };
  },
});

/**
 * Migration: Delete legacy backlog tasks from chatroom_tasks.
 *
 * After migrateBacklogItemsToBacklogTable and remapBacklogTaskIdsInMessages have
 * run, the old chatroom_tasks records with origin="backlog" are no longer needed.
 * This migration cleans them up by deleting only those that have been successfully
 * migrated (confirmed by presence of a chatroom_backlog record with matching
 * legacyTaskId).
 *
 * Behavior:
 *   - Queries all chatroom_tasks with origin === "backlog"
 *   - For each, checks if a chatroom_backlog record exists with legacyTaskId === task._id
 *   - If confirmed migrated → deletes the task record
 *   - If NOT yet migrated → skips it (does not delete)
 *
 * Idempotent: tasks already deleted are simply not found on re-run.
 *
 * After running this migration in production:
 *   1. Move this description to "Previously executed migrations" list above.
 *   2. The `origin: "backlog"` literal can be removed from chatroom_tasks.status
 *      in schema.ts (if no longer needed for other purposes).
 *
 * Run from the Convex dashboard:
 *   internal.migration.deleteBacklogOriginTasks
 */
export const deleteBacklogOriginTasks = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Get all tasks with origin="backlog"
    const allTasks = await ctx.db.query('chatroom_tasks').collect();
    const backlogTasks = allTasks.filter((task) => task.origin === 'backlog');

    let deleted = 0;
    let skipped = 0;

    for (const task of backlogTasks) {
      // Check if a corresponding backlog item exists with this task's ID as legacyTaskId
      const backlogItem = await ctx.db
        .query('chatroom_backlog')
        .withIndex('by_legacy_task_id', (q) => q.eq('legacyTaskId', task._id))
        .first();

      if (backlogItem) {
        // Confirmed migrated — safe to delete
        await ctx.db.delete(task._id);
        deleted++;
      } else {
        // Not yet migrated — skip to preserve data
        skipped++;
      }
    }

    return {
      total: backlogTasks.length,
      deleted,
      skipped,
    };
  },
});
