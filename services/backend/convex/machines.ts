/** Convex functions for machine registration, agent config, and remote command dispatch. */

import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { getSession, requireSession } from './auth/session';
import { checkAccess, requireAccess } from '../modules/auth/accessCheck';
import { getMachineOwner, requireMachineOwner } from './auth/cli/machineAccess';
import { agentHarnessValidator } from './schema';
import { buildTeamRoleKey, deleteStaleTeamAgentConfigs } from './utils/teamRoleKey';
import { str } from './utils/types';
import { DAEMON_LIVENESS_WRITE_INTERVAL_MS, OBSERVATION_TTL_MS } from '../config/reliability';
import {
  agentStopReasonValidator,
  agentTypeValidator,
  machineCommandTypeValidator,
} from '../src/domain/entities/agent';
import { roleSupportsAutoRestartOnNewContextSetting } from '../src/domain/entities/team-agent-settings';
import { agentExited as agentExitedUseCase } from '../src/domain/usecase/agent/agent-exited';
import { assertMachineBelongsToChatroom } from '../src/domain/usecase/agent/assert-machine-belongs-to-chatroom';
import { ensureOnlyAgentForRole } from '../src/domain/usecase/agent/ensure-only-agent-for-role';
import { getAgentConfigForStart } from '../src/domain/usecase/agent/get-agent-config-for-start';
import { listChatroomAgentOverview } from '../src/domain/usecase/agent/list-chatroom-agent-overview';
import { restartOfflineAgentsOnUserMessage } from '../src/domain/usecase/agent/restart-offline-agents-on-user-message';
import { startAgent as startAgentUseCase } from '../src/domain/usecase/agent/start-agent';
import { stopAgent as stopAgentUseCase } from '../src/domain/usecase/agent/stop-agent';
import { transitionAgentStatus } from '../src/domain/usecase/agent/transition-agent-status';
import { getAgentStatusForChatroom } from '../src/domain/usecase/chatroom/get-agent-statuses';
import { getAssignedTaskForAction as getAssignedTaskForActionForMachine } from '../src/domain/usecase/machine/get-assigned-task-for-action';
import { listAssignedTasksForReconcileForMachine } from '../src/domain/usecase/machine/list-assigned-tasks-for-reconcile';
import { subscribeAssignedTaskSignalsForMachine } from '../src/domain/usecase/machine/subscribe-assigned-task-signals';
import { onAgentExited } from '../src/events/agent/on-agent-exited';

// ─── Shared Helpers ──────────────────────────────────────────────────

/**
 * Default start-agent policy: first bind (no machine on team config) allows omitted flag;
 * once bound, switching machines requires explicit `allowNewMachine: true`.
 */
function resolveAllowNewMachineForStart(
  payload: { allowNewMachine?: boolean } | undefined,
  existingConfig: Doc<'chatroom_teamAgentConfigs'> | null
): boolean {
  if (payload?.allowNewMachine !== undefined) return payload.allowNewMachine;
  return !existingConfig?.machineId;
}

/** Convert a Convex Id to a plain string for the pure-function layer. */

/** Validates an absolute working directory path, rejecting unsafe characters. */
function validateWorkingDir(workingDir: string): void {
  if (!workingDir || workingDir.trim().length === 0) {
    throw new Error('Working directory cannot be empty');
  }

  if (workingDir.length > 1024) {
    throw new Error('Working directory path is too long (max 1024 characters)');
  }

  // Must be an absolute path
  if (!workingDir.startsWith('/')) {
    throw new Error('Working directory must be an absolute path (starting with /)');
  }

  // Reject null bytes
  if (workingDir.includes('\0')) {
    throw new Error('Working directory contains invalid characters (null byte)');
  }

  // Reject newlines / carriage returns
  if (/[\n\r]/.test(workingDir)) {
    throw new Error('Working directory must not contain newlines');
  }

  // Reject shell metacharacters that could enable injection
  // These have no legitimate use in directory paths
  const shellMetaChars = /[;|&$`(){}<>!#~\\]/;
  if (shellMetaChars.test(workingDir)) {
    throw new Error(
      'Working directory contains disallowed characters. ' +
        'Only alphanumeric characters, hyphens, underscores, dots, slashes, and spaces are allowed.'
    );
  }
}

/**
 * Look up a machine by its machineId. Throws if not found.
 */
async function getMachineByMachineId(ctx: QueryCtx | MutationCtx, machineId: string) {
  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();
  if (!machine) {
    throw new Error('Machine not found');
  }
  return machine;
}

/**
 * Look up a machine and verify ownership. Throws if not found or not owned.
 */
async function getOwnedMachine(
  ctx: QueryCtx | MutationCtx,
  machineId: string,
  userId: Id<'users'>
) {
  const machine = await getMachineByMachineId(ctx, machineId);
  if (machine.userId !== userId) {
    throw new Error('Machine is registered to a different user');
  }
  return machine;
}

// ============================================================================
// MACHINE MODELS — EXTRACTED TABLE
// ============================================================================

/**
 * Upsert per-machine row in chatroom_machineModels.
 *
 * One row per machine; the whole Record<harness, models[]> lives in a single row.
 * Skips the write when availableModels is undefined (don't clobber existing data
 * with an empty/absent payload from old daemons that don't send models).
 * Also skips when the content is structurally identical to the existing row
 * (JSON.stringify deep-equality) — no-op writes still invalidate Convex
 * subscriptions, so we must suppress them to achieve the bandwidth goal.
 */
async function upsertMachineModels(
  ctx: MutationCtx,
  machineId: string,
  availableModels: Record<string, string[]> | undefined
): Promise<void> {
  if (availableModels === undefined) {
    // Don't clobber existing models when caller didn't supply them.
    return;
  }

  const existing = await ctx.db
    .query('chatroom_machineModels')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();

  if (existing) {
    // Skip write if content is identical — prevents subscription invalidation churn.
    // JSON.stringify is safe here: JS object key order is insertion-order-stable and
    // daemons write the same harness key order on every call. A true reordering would
    // indicate a genuine harness-list change and trigger a real write (correct behaviour).
    if (JSON.stringify(existing.availableModels) === JSON.stringify(availableModels)) {
      return;
    }
    await ctx.db.patch('chatroom_machineModels', existing._id, {
      availableModels,
      updatedAt: Date.now(),
    });
  } else {
    await ctx.db.insert('chatroom_machineModels', {
      machineId,
      availableModels,
      updatedAt: Date.now(),
    });
  }
}

// ============================================================================
// MACHINE REGISTRATION
// ============================================================================

/** Registers or updates a machine record for the current user. */
// Harness version validator
const harnessVersionValidator = v.object({
  version: v.string(),
  major: v.number(),
});

export const register = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    hostname: v.string(),
    os: v.string(),
    availableHarnesses: v.array(agentHarnessValidator),
    harnessVersions: v.optional(v.record(v.string(), harnessVersionValidator)),
    availableModels: v.optional(v.record(v.string(), v.array(v.string()))),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }
    const userId = auth.userId;
    const now = Date.now();

    // Check if machine already exists
    const existing = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    if (existing) {
      if (existing.userId !== userId) {
        throw new Error(
          `machineId "${args.machineId}" is already registered to another user. Generate a new machineId (delete local config and re-run "chatroom machine register").`
        );
      }

      if (existing.hostname !== args.hostname) {
        console.warn(
          `[chatroom] Machine "${args.machineId}" hostname changed from "${existing.hostname}" to "${args.hostname}" — updating registration.`
        );
      }

      // Update existing machine
      await ctx.db.patch('chatroom_machines', existing._id, {
        hostname: args.hostname,
        os: args.os,
        availableHarnesses: args.availableHarnesses,
        harnessVersions: args.harnessVersions,
        ...(args.availableModels !== undefined ? { availableModels: args.availableModels } : {}),
        lastSeenAt: now,
      });

      // Dual-write into dedicated models table (re-register / update path)
      await upsertMachineModels(ctx, args.machineId, args.availableModels);

      return { machineId: args.machineId, isNew: false };
    }

    // Create new machine registration
    await ctx.db.insert('chatroom_machines', {
      machineId: args.machineId,
      userId: userId,
      hostname: args.hostname,
      os: args.os,
      availableHarnesses: args.availableHarnesses,
      harnessVersions: args.harnessVersions,
      availableModels: args.availableModels,
      registeredAt: now,
      lastSeenAt: now,
      daemonConnected: false,
    });

    // Dual-write into dedicated models table (new-insert path)
    await upsertMachineModels(ctx, args.machineId, args.availableModels);

    return { machineId: args.machineId, isNew: true };
  },
});

/** Sets or clears the user-defined alias for a machine. */
export const setMachineAlias = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    alias: v.optional(v.string()), // undefined or empty string to clear
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }
    const machine = await getOwnedMachine(ctx, args.machineId, auth.userId);

    // Normalize: empty string or whitespace-only = clear alias
    const normalizedAlias = args.alias?.trim() || undefined;

    // Validate length
    if (normalizedAlias && normalizedAlias.length > 64) {
      throw new Error('Machine alias must be 64 characters or fewer');
    }

    await ctx.db.patch('chatroom_machines', machine._id, {
      alias: normalizedAlias,
    });

    return { success: true };
  },
});

/**
 * Patch mutable capabilities on an already-registered machine.
 * Used by the daemon's periodic refresh loop — only updates fields that
 * can change at runtime (harnesses, models). Fails if the machine has
 * not been registered via `register` first.
 */
export const refreshCapabilities = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    availableHarnesses: v.array(agentHarnessValidator),
    harnessVersions: v.optional(v.record(v.string(), harnessVersionValidator)),
    availableModels: v.optional(v.record(v.string(), v.array(v.string()))),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }
    const userId = auth.userId;

    const existing = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    if (!existing) {
      throw new Error('Machine not registered. Run `chatroom machine start` first.');
    }
    if (existing.userId !== userId) {
      throw new Error('Machine is registered to a different user');
    }

    await ctx.db.patch('chatroom_machines', existing._id, {
      availableHarnesses: args.availableHarnesses,
      harnessVersions: args.harnessVersions,
      availableModels: args.availableModels,
      lastSeenAt: Date.now(),
    });

    // Dual-write into dedicated models table (suppresses no-op writes for bandwidth)
    await upsertMachineModels(ctx, args.machineId, args.availableModels);
  },
});

/**
 * Request a capabilities refresh (model/harness discovery) for one machine.
 * The machine must belong to the current user and have at least one workspace
 * linked to the given chatroom. Uses a 10-second cooldown per machine
 * (`lastCapabilitiesRefreshRequestedAt`).
 *
 * Creates a `chatroom_capabilities_refresh_batches` row (expected count 1) plus
 * a per-machine result row so the webapp can subscribe until the daemon reports.
 */
const CAPABILITIES_REFRESH_ERROR_MESSAGE_MAX = 2000;
const CAPABILITIES_REFRESH_QUERY_ERROR_PREVIEW_MAX = 500;

export const requestCapabilitiesRefresh = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }
    const userId = auth.userId;

    await requireAccess(ctx, {
      accessor: { type: 'user', id: userId },
      resource: { type: 'chatroom', id: str(args.chatroomId) },
      permission: 'write-access',
    });

    const now = Date.now();
    const COOLDOWN_MS = 10 * 1000; // 10 seconds

    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    if (!machine || machine.userId !== userId) {
      return { applied: false as const, reason: 'not_owner' as const };
    }

    const workspaces = await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_machine', (q) => q.eq('machineId', args.machineId))
      .filter((q) => q.eq(q.field('chatroomId'), args.chatroomId))
      .collect();

    if (workspaces.length === 0) {
      return { applied: false as const, reason: 'not_linked' as const };
    }

    const lastRefresh = machine.lastCapabilitiesRefreshRequestedAt ?? 0;
    if (now - lastRefresh < COOLDOWN_MS) {
      const rawRemaining = COOLDOWN_MS - (now - lastRefresh);
      return {
        applied: false as const,
        reason: 'cooldown' as const,
        retryAfterMs: Math.max(0, Math.min(COOLDOWN_MS, rawRemaining)),
      };
    }

    const batchId = await ctx.db.insert('chatroom_capabilities_refresh_batches', {
      chatroomId: args.chatroomId,
      userId: userId,
      createdAt: now,
      expectedMachineCount: 1,
      finishedMachineCount: 0,
      aggregateStatus: 'pending',
    });

    await ctx.db.insert('chatroom_capabilities_refresh_machine_results', {
      batchId,
      chatroomId: args.chatroomId,
      machineId: machine.machineId,
      status: 'pending',
      createdAt: now,
    });

    await ctx.db.insert('chatroom_eventStream', {
      type: 'daemon.refreshCapabilities',
      machineId: machine.machineId,
      timestamp: now,
      batchId,
    });

    await ctx.db.patch('chatroom_machines', machine._id, {
      lastCapabilitiesRefreshRequestedAt: now,
    });

    return { applied: true as const, batchId };
  },
});

const capabilitiesRefreshTerminalStatusValidator = v.union(
  v.literal('completed'),
  v.literal('skipped_no_changes'),
  v.literal('failed')
);

/**
 * Called by the CLI daemon after handling `daemon.refreshCapabilities` so the
 * webapp can observe per-machine outcomes. Idempotent if already terminal.
 */
export const reportCapabilitiesRefreshResult = mutation({
  args: {
    ...SessionIdArg,
    batchId: v.id('chatroom_capabilities_refresh_batches'),
    machineId: v.string(),
    status: capabilitiesRefreshTerminalStatusValidator,
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }
    const userId = auth.userId;

    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    if (!machine || machine.userId !== userId) {
      throw new Error('Machine not found or not owned by the current user');
    }

    const batch = await ctx.db.get('chatroom_capabilities_refresh_batches', args.batchId);
    if (!batch) {
      throw new Error('Refresh batch not found');
    }
    if (batch.userId !== userId) {
      throw new Error('Refresh batch does not belong to the current user');
    }

    const result = await ctx.db
      .query('chatroom_capabilities_refresh_machine_results')
      .withIndex('by_batchId_machineId', (q) =>
        q.eq('batchId', args.batchId).eq('machineId', args.machineId)
      )
      .unique();

    if (!result) {
      throw new Error('No refresh result row for this machine in the batch');
    }

    if (result.status !== 'pending') {
      return { ok: true as const, duplicate: true as const };
    }

    const finishedAt = Date.now();
    const errorMessage =
      args.errorMessage !== undefined
        ? args.errorMessage.slice(0, CAPABILITIES_REFRESH_ERROR_MESSAGE_MAX)
        : undefined;
    await ctx.db.patch('chatroom_capabilities_refresh_machine_results', result._id, {
      status: args.status,
      finishedAt,
      errorMessage,
    });

    const rows = await ctx.db
      .query('chatroom_capabilities_refresh_machine_results')
      .withIndex('by_batchId', (q) => q.eq('batchId', args.batchId))
      .collect();

    const finishedCount = rows.filter((r) => r.status !== 'pending').length;
    const allTerminal = finishedCount === batch.expectedMachineCount;

    if (!allTerminal) {
      await ctx.db.patch('chatroom_capabilities_refresh_batches', args.batchId, {
        finishedMachineCount: finishedCount,
      });
      return { ok: true as const, duplicate: false as const };
    }

    const failedCount = rows.filter((r) => r.status === 'failed').length;
    const aggregateStatus =
      failedCount === 0 ? 'completed' : failedCount === rows.length ? 'failed' : 'partial';

    await ctx.db.patch('chatroom_capabilities_refresh_batches', args.batchId, {
      finishedMachineCount: finishedCount,
      aggregateStatus,
    });

    return { ok: true as const, duplicate: false as const };
  },
});

/** Batch + per-machine rows for the capabilities refresh UI. */
export const getCapabilitiesRefreshBatch = query({
  args: {
    ...SessionIdArg,
    batchId: v.id('chatroom_capabilities_refresh_batches'),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;

    const batch = await ctx.db.get('chatroom_capabilities_refresh_batches', args.batchId);
    if (!batch) return null;

    const accessResult = await checkAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'chatroom', id: str(batch.chatroomId) },
      permission: 'read-access',
    });
    if (!accessResult.ok) return null;

    const machines = await ctx.db
      .query('chatroom_capabilities_refresh_machine_results')
      .withIndex('by_batchId', (q) => q.eq('batchId', args.batchId))
      .collect();

    return {
      batch: {
        _id: batch._id,
        chatroomId: batch.chatroomId,
        createdAt: batch.createdAt,
        expectedMachineCount: batch.expectedMachineCount,
        finishedMachineCount: batch.finishedMachineCount,
        aggregateStatus: batch.aggregateStatus,
      },
      machines: machines.map((m) => ({
        machineId: m.machineId,
        status: m.status,
        finishedAt: m.finishedAt,
        errorMessage: m.errorMessage
          ? m.errorMessage.slice(0, CAPABILITIES_REFRESH_QUERY_ERROR_PREVIEW_MAX)
          : undefined,
      })),
    };
  },
});

// ============================================================================
// ============================================================================
// QUERIES
// ============================================================================

/**
 * List all machines for the current user.
 */
export const listMachines = query({
  args: {
    ...SessionIdArg,
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      return { machines: [] };
    }
    const userId = auth.userId;

    const machines = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect();

    return {
      machines: machines.map((m) => ({
        machineId: m.machineId,
        hostname: m.hostname,
        alias: m.alias,
        os: m.os,
        availableHarnesses: m.availableHarnesses,
        harnessVersions: m.harnessVersions ?? {},
        registeredAt: m.registeredAt,
      })),
    };
  },
});

/**
 * Per-machine available model list, read from the new chatroom_machineModels table.
 * Falls back to the legacy chatroom_machines.availableModels field for machines that
 * have not yet been back-filled by the dropEmbeddedAvailableModels migration.
 */
export const getMachineModels = query({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, args) => {
    const auth = await getMachineOwner(ctx, args.sessionId, args.machineId);
    if (!auth) return { availableModels: {} as Record<string, string[]> };

    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    if (!machine) return { availableModels: {} as Record<string, string[]> };

    // Prefer new table; fall back to legacy field if migration hasn't backfilled yet.
    const newRow = await ctx.db
      .query('chatroom_machineModels')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    if (newRow) {
      return { availableModels: newRow.availableModels };
    }

    // Legacy fallback: machine.availableModels may be Record OR legacy string[].
    const legacy = machine.availableModels;
    if (legacy && !Array.isArray(legacy)) return { availableModels: legacy };
    if (Array.isArray(legacy)) return { availableModels: { opencode: legacy } };
    return { availableModels: {} as Record<string, string[]> };
  },
});

/** Returns daemon connectivity status for a specific machine. Used by the webapp to detect daemon presence via Convex instead of localhost HTTP. */
export const getDaemonStatus = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getMachineOwner(ctx, args.sessionId, args.machineId);
    if (!auth) {
      return { connected: false, lastSeenAt: null };
    }

    // Read status from materialized machineStatus table
    const machineStatus = await ctx.db
      .query('chatroom_machineStatus')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    // Read lastSeenAt from liveness table (updated at most every DAEMON_LIVENESS_WRITE_INTERVAL_MS)
    const liveness = await ctx.db
      .query('chatroom_machineLiveness')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    return {
      connected: machineStatus?.status === 'online',
      lastSeenAt: liveness?.lastSeenAt ?? 0,
    };
  },
});

const MAX_DAEMON_STATUS_BATCH = 10;

/** Batch daemon connectivity for multiple machines in one subscription. */
export const getDaemonStatusesBatch = query({
  args: {
    ...SessionIdArg,
    machineIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const machineIds = args.machineIds.slice(0, MAX_DAEMON_STATUS_BATCH);
    const statuses: {
      machineId: string;
      connected: boolean;
      lastSeenAt: number | null;
    }[] = [];

    for (const machineId of machineIds) {
      const auth = await getMachineOwner(ctx, args.sessionId, machineId);
      if (!auth) {
        statuses.push({ machineId, connected: false, lastSeenAt: null });
        continue;
      }

      const machineStatus = await ctx.db
        .query('chatroom_machineStatus')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();

      const liveness = await ctx.db
        .query('chatroom_machineLiveness')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();

      statuses.push({
        machineId,
        connected: machineStatus?.status === 'online',
        lastSeenAt: liveness?.lastSeenAt ?? null,
      });
    }

    return { statuses };
  },
});

/** Returns machine-level agent configs for a chatroom, enriched with machine details. */
export const getMachineAgentConfigs = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      return { configs: [] };
    }
    const userId = auth.userId;

    // Verify chatroom access
    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom || chatroom.ownerId !== userId) {
      return { configs: [] };
    }

    // Get the user's machines for ownership filtering
    const userMachines = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect();
    const userMachineMap = new Map(userMachines.map((m) => [m.machineId, m]));

    // Read status from materialized machineStatus table
    const statusMap = new Map<string, { daemonConnected: boolean }>();
    for (const machine of userMachines) {
      const machineStatus = await ctx.db
        .query('chatroom_machineStatus')
        .withIndex('by_machineId', (q) => q.eq('machineId', machine.machineId))
        .first();
      statusMap.set(machine.machineId, { daemonConnected: machineStatus?.status === 'online' });
    }

    const allConfigs = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Filter to only configs for the CURRENT team and machines the user owns.
    // Stale configs from old teams (after a team switch) must be excluded to
    // prevent the UI from seeing spawnedAgentPid on old-team configs.
    const currentTeamId = chatroom.teamId;
    const userConfigs = allConfigs.filter((c) => {
      if (!c.machineId || !userMachineMap.has(c.machineId)) return false;
      // Only include configs for the current team
      if (currentTeamId && c.teamRoleKey) {
        return c.teamRoleKey.includes(`#team_${currentTeamId}#`);
      }
      return true;
    });

    const configsWithMachine = userConfigs.flatMap((config) => {
      const machineId = config.machineId;
      if (!machineId) return [];
      const machine = userMachineMap.get(machineId);
      const status = statusMap.get(machineId);
      return [
        {
          machineId,
          hostname: machine?.hostname ?? 'Unknown',
          alias: machine?.alias,
          role: config.role,
          agentType: config.agentHarness,
          workingDir: config.workingDir,
          model: config.model,
          daemonConnected: status?.daemonConnected ?? false,
          availableHarnesses: machine?.availableHarnesses ?? [],
          updatedAt: config.updatedAt,
          spawnedAgentPid: config.spawnedAgentPid,
          spawnedAt: config.spawnedAt,
          wantResume: config.wantResume,
        },
      ];
    });

    return { configs: configsWithMachine };
  },
});

/** Returns pending agent.requestStart, agent.requestStop, and daemon.ping events for a machine. */
export const getCommandEvents = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getMachineOwner(ctx, args.sessionId, args.machineId);
    if (!auth) return { events: [] };

    const now = Date.now();

    // 3. Fetch agent.requestStart events — deadline-filtered (not cursor-filtered)
    //    Ensures valid commands issued before a daemon restart are not skipped.
    const startEvents = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_machineId_type', (q) =>
        q.eq('machineId', args.machineId).eq('type', 'agent.requestStart')
      )
      .filter((q) => q.gt(q.field('deadline'), now))
      .order('asc')
      .collect();

    const requestStartEvents = startEvents.filter((e) => e.type === 'agent.requestStart');

    // 4. Fetch agent.requestStop events — deadline-filtered (not cursor-filtered)
    const stopEvents = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_machineId_type', (q) =>
        q.eq('machineId', args.machineId).eq('type', 'agent.requestStop')
      )
      .filter((q) => q.gt(q.field('deadline'), now))
      .order('asc')
      .collect();

    // 5. Fetch daemon.ping events — time-bounded to reduce payload
    // NOTE: .filter() reduces payload size but does NOT reduce DB reads.
    // The TTL cron (eventCleanup) is what actually reduces read bandwidth.
    const PING_TTL_MS = 5 * 60_000; // 5 minutes
    const pingEvents = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_machineId_type', (q) =>
        q.eq('machineId', args.machineId).eq('type', 'daemon.ping')
      )
      .filter((q) => q.gt(q.field('timestamp'), now - PING_TTL_MS))
      .order('asc')
      .collect();

    // 6. Fetch daemon.gitRefresh events — time-bounded to reduce payload
    // NOTE: .filter() reduces payload size but does NOT reduce DB reads.
    // The TTL cron (eventCleanup) is what actually reduces read bandwidth.
    const GIT_REFRESH_TTL_MS = 5 * 60_000; // 5 minutes
    const gitRefreshEvents = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_machineId_type', (q) =>
        q.eq('machineId', args.machineId).eq('type', 'daemon.gitRefresh')
      )
      .filter((q) => q.gt(q.field('timestamp'), now - GIT_REFRESH_TTL_MS))
      .order('asc')
      .collect();

    const CAPABILITIES_REFRESH_TTL_MS = 5 * 60_000; // 5 minutes
    const capabilitiesRefreshEvents = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_machineId_type', (q) =>
        q.eq('machineId', args.machineId).eq('type', 'daemon.refreshCapabilities')
      )
      .filter((q) => q.gt(q.field('timestamp'), now - CAPABILITIES_REFRESH_TTL_MS))
      .order('asc')
      .collect();

    // 5b. Local action events (open-vscode, open-finder, etc.)
    // Time-filtered to avoid replaying stale actions on daemon restart.
    const LOCAL_ACTION_TTL_MS = 60_000; // 1 minute
    const COMMAND_EVENT_TTL_MS = 60_000; // 1 minute
    const localActionEvents = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_machineId_type', (q) =>
        q.eq('machineId', args.machineId).eq('type', 'daemon.localAction')
      )
      .filter((q) => q.gt(q.field('timestamp'), now - LOCAL_ACTION_TTL_MS))
      .order('asc')
      .collect();

    // 6. Command runner events (command.run / command.stop)
    // Time-filtered to avoid replaying stale commands on daemon restart.
    const commandRunEvents = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_machineId_type', (q) =>
        q.eq('machineId', args.machineId).eq('type', 'command.run')
      )
      .filter((q) => q.gt(q.field('timestamp'), now - COMMAND_EVENT_TTL_MS))
      .order('asc')
      .collect();

    const commandStopEvents = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_machineId_type', (q) =>
        q.eq('machineId', args.machineId).eq('type', 'command.stop')
      )
      .filter((q) => q.gt(q.field('timestamp'), now - COMMAND_EVENT_TTL_MS))
      .order('asc')
      .collect();

    // 7. Merge and sort by _creationTime ascending
    const all = [
      ...requestStartEvents,
      ...stopEvents,
      ...pingEvents,
      ...gitRefreshEvents,
      ...capabilitiesRefreshEvents,
      ...localActionEvents,
      ...commandRunEvents,
      ...commandStopEvents,
    ].sort((a, b) => (a._creationTime < b._creationTime ? -1 : 1));

    return { events: all };
  },
});

/** Returns the daemon.pong event for a machine that came after a given ping event. */
export const getDaemonPongEvent = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    afterEventId: v.optional(v.id('chatroom_eventStream')),
  },
  handler: async (ctx, args) => {
    const auth = await getMachineOwner(ctx, args.sessionId, args.machineId);
    if (!auth) return null;

    const pongEvents = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_machineId_type', (q) =>
        q.eq('machineId', args.machineId).eq('type', 'daemon.pong')
      )
      .order('asc')
      .collect();

    const afterEventId = args.afterEventId;
    const matching = afterEventId ? pongEvents.filter((e) => e._id > afterEventId) : pongEvents;

    return matching.length > 0 ? matching[matching.length - 1] : null;
  },
});

/**
 * @deprecated Frontend now reads agent status from participant.lastStatus.
 * Retained for backward compatibility and debugging.
 * Returns the latest event stream entry for a given chatroom+role, or null.
 */
export const getLatestAgentEvent = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    // Auth check
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;

    // Verify chatroom access
    const accessResult = await checkAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'chatroom', id: str(args.chatroomId) },
      permission: 'read-access',
    });
    if (!accessResult.ok) return null;

    // Fetch the latest event for this chatroom+role using the index
    const event = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroomId_role', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .order('desc')
      .first();

    return event ?? null;
  },
});

/**
 * @deprecated Frontend now reads agent status from participant.lastStatus.
 * Retained for backward compatibility and debugging.
 * Returns a map of role → latest event type for all specified roles in a chatroom.
 */
export const getLatestAgentEventsForChatroom = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    roles: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Auth check
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return {};

    // Verify chatroom access (single lookup — also used for teamId below)
    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom) return {};
    if (chatroom.ownerId !== auth.userId) return {};

    // Fetch latest event + team config for each role in parallel
    const results = await Promise.all(
      args.roles.map(async (role) => {
        const event = await ctx.db
          .query('chatroom_eventStream')
          .withIndex('by_chatroomId_role', (q) =>
            q.eq('chatroomId', args.chatroomId).eq('role', role)
          )
          .order('desc')
          .first();
        let teamConfig: Doc<'chatroom_teamAgentConfigs'> | null = null;
        if (chatroom?.teamId) {
          const teamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, role);
          teamConfig = await ctx.db
            .query('chatroom_teamAgentConfigs')
            .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
            .first();
        }
        return {
          role,
          event: event ?? null,
          desiredState: teamConfig?.desiredState ?? null,
        };
      })
    );

    // Build role → { latestEventType, desiredState } map
    // Roles with no events are omitted from the map.
    const eventMap: Record<string, { eventType: string; desiredState: string | null }> = {};
    for (const { role, event, desiredState } of results) {
      if (event !== null) {
        eventMap[role] = { eventType: event.type, desiredState };
      }
    }

    return eventMap;
  },
});

// ============================================================================
// COMMAND MANAGEMENT
// ============================================================================

/** Updates daemon connection status (connected or disconnected). */
export const updateDaemonStatus = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    connected: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const machine = await getMachineByMachineId(ctx, args.machineId);

    const now = Date.now();

    // TODO: Remove once chatroom_machineStatus is the sole source of truth.
    // Kept for backward compatibility during migration.
    await ctx.db.patch('chatroom_machines', machine._id, {
      daemonConnected: args.connected,
      lastSeenAt: now,
    });

    // Also update liveness table
    const existingLiveness = await ctx.db
      .query('chatroom_machineLiveness')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    if (existingLiveness) {
      await ctx.db.patch('chatroom_machineLiveness', existingLiveness._id, {
        lastSeenAt: now,
        daemonConnected: args.connected,
      });
    } else {
      await ctx.db.insert('chatroom_machineLiveness', {
        machineId: args.machineId,
        lastSeenAt: now,
        daemonConnected: args.connected,
      });
    }

    // Update materialized machine status — only write on actual transition
    const desiredStatus: 'online' | 'offline' = args.connected ? 'online' : 'offline';
    const machineStatus = await ctx.db
      .query('chatroom_machineStatus')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    if (!machineStatus) {
      // No row yet — insert with desired status
      await ctx.db.insert('chatroom_machineStatus', {
        machineId: args.machineId,
        status: desiredStatus,
        lastTransitionAt: now,
      });
    } else if (machineStatus.status !== desiredStatus) {
      // Actual state transition — write
      await ctx.db.patch('chatroom_machineStatus', machineStatus._id, {
        status: desiredStatus,
        lastTransitionAt: now,
      });
    }
    // If status matches desired, do NOT write (write suppression)

    return { success: true };
  },
});

async function upsertDaemonLiveness(
  ctx: MutationCtx,
  machineId: string,
  now: number,
  existing: Doc<'chatroom_machineLiveness'> | null
): Promise<void> {
  if (existing) {
    const livenessStale = now - existing.lastSeenAt >= DAEMON_LIVENESS_WRITE_INTERVAL_MS;
    const needsDaemonConnected = existing.daemonConnected !== true;
    if (!livenessStale && !needsDaemonConnected) return;
    await ctx.db.patch('chatroom_machineLiveness', existing._id, {
      ...(livenessStale ? { lastSeenAt: now } : {}),
      ...(needsDaemonConnected ? { daemonConnected: true } : {}),
    });
    return;
  }
  await ctx.db.insert('chatroom_machineLiveness', {
    machineId,
    lastSeenAt: now,
    daemonConnected: true,
  });
}

async function ensureMachineStatusOnline(
  ctx: MutationCtx,
  machineStatus: Doc<'chatroom_machineStatus'> | null,
  machineId: string,
  now: number
): Promise<void> {
  if (!machineStatus) {
    await ctx.db.insert('chatroom_machineStatus', {
      machineId,
      status: 'online',
      lastTransitionAt: now,
    });
    return;
  }
  if (machineStatus.status === 'offline') {
    await ctx.db.patch('chatroom_machineStatus', machineStatus._id, {
      status: 'online',
      lastTransitionAt: now,
    });
  }
}

function isDaemonHeartbeatNoop(
  existingLiveness: Doc<'chatroom_machineLiveness'> | null,
  machineStatus: Doc<'chatroom_machineStatus'> | null,
  now: number
): boolean {
  const livenessFresh =
    existingLiveness != null &&
    now - existingLiveness.lastSeenAt < DAEMON_LIVENESS_WRITE_INTERVAL_MS;
  const alreadyOnline =
    existingLiveness?.daemonConnected === true && machineStatus?.status === 'online';
  return livenessFresh && alreadyOnline;
}

/** Updates lastSeenAt for liveness detection; sets daemonConnected to true. */
export const daemonHeartbeat = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const now = Date.now();
    const existingLiveness = await ctx.db
      .query('chatroom_machineLiveness')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    const machineStatus = await ctx.db
      .query('chatroom_machineStatus')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    if (isDaemonHeartbeatNoop(existingLiveness, machineStatus, now)) {
      return { success: true, noop: true };
    }
    await upsertDaemonLiveness(ctx, args.machineId, now, existingLiveness);
    await ensureMachineStatusOnline(ctx, machineStatus, args.machineId, now);
    return { success: true };
  },
});

/**
 * Dispatches a local action (open-vscode, open-finder, open-github-desktop, git operations) to a machine
 * via the Convex event stream, avoiding direct localhost HTTP calls from the browser.
 * This fixes Safari's mixed-content blocking of http://localhost from HTTPS pages.
 */
export const sendLocalAction = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    action: v.union(
      v.literal('open-vscode'),
      v.literal('open-finder'),
      v.literal('open-github-desktop'),
      v.literal('git-discard-file'),
      v.literal('git-discard-all'),
      v.literal('git-pull'),
      v.literal('git-push'),
      v.literal('git-sync')
    ),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }
    const userId = auth.userId;
    await getOwnedMachine(ctx, args.machineId, userId);

    validateWorkingDir(args.workingDir);

    await ctx.db.insert('chatroom_eventStream', {
      type: 'daemon.localAction',
      machineId: args.machineId,
      action: args.action,
      workingDir: args.workingDir,
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

/** Dispatches a start-agent, stop-agent, or ping command to a machine on behalf of the user. */
export const sendCommand = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    type: machineCommandTypeValidator,
    payload: v.optional(
      v.object({
        chatroomId: v.optional(v.id('chatroom_rooms')),
        role: v.optional(v.string()),
        model: v.optional(v.string()),
        // For first-time starts when no agent config exists:
        agentHarness: v.optional(agentHarnessValidator),
        workingDir: v.optional(v.string()),
        /** When true, allows binding to a new machine or switching from a previously bound machine. */
        allowNewMachine: v.optional(v.boolean()),
        /** When true (default), resume from the daemon's last session on first launch. */
        wantResume: v.optional(v.boolean()),
        // For stop-agent: optional reason (defaults to 'user.stop')
        reason: v.optional(agentStopReasonValidator),
      })
    ),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }
    const userId = auth.userId;
    const machine = await getOwnedMachine(ctx, args.machineId, userId);

    // Sanitize workingDir if provided in the payload
    if (args.payload?.workingDir) {
      validateWorkingDir(args.payload.workingDir);
    }

    // ── start-agent: resolve defaults then delegate to use case ────────
    if (args.type === 'start-agent' && args.payload?.chatroomId && args.payload?.role) {
      // Read existing config for fallback values when payload is incomplete
      const cmdChatroom = await ctx.db.get('chatroom_rooms', args.payload.chatroomId);
      let existingConfig: Doc<'chatroom_teamAgentConfigs'> | null = null;
      if (cmdChatroom?.teamId) {
        const teamRoleKey = buildTeamRoleKey(
          cmdChatroom._id,
          cmdChatroom.teamId,
          args.payload.role
        );
        existingConfig = await ctx.db
          .query('chatroom_teamAgentConfigs')
          .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
          .first();
      }

      const resolvedModel =
        args.payload.model ??
        (existingConfig?.type === 'remote' ? existingConfig.model : undefined);
      const resolvedHarness =
        args.payload.agentHarness ??
        (existingConfig?.type === 'remote' ? existingConfig.agentHarness : undefined);
      const resolvedWorkingDir =
        args.payload.workingDir ??
        (existingConfig?.type === 'remote' ? existingConfig.workingDir : undefined);
      // Backfill the resume preference from the persisted config when the caller
      // omits it (e.g. a restart that doesn't re-send the flag). Without this, an
      // omitted value would fall through to the use-case default and silently
      // reset a previously-persisted `false` back to `true`.
      const resolvedWantResume =
        args.payload.wantResume ??
        (existingConfig?.type === 'remote' ? existingConfig.wantResume : undefined);

      if (!resolvedModel || !resolvedHarness || !resolvedWorkingDir) {
        throw new Error(
          'Cannot start agent: model, agentHarness, and workingDir are required. ' +
            'Provide them in the payload or ensure an existing config exists.'
        );
      }

      const allowNewMachine = resolveAllowNewMachineForStart(args.payload, existingConfig);
      await assertMachineBelongsToChatroom(ctx, {
        chatroomId: args.payload.chatroomId,
        machineId: args.machineId,
        role: args.payload.role,
        allowNewMachine,
      });

      await startAgentUseCase(
        ctx,
        {
          machineId: args.machineId,
          chatroomId: args.payload.chatroomId,
          role: args.payload.role,
          userId: userId,
          model: resolvedModel,
          agentHarness: resolvedHarness,
          workingDir: resolvedWorkingDir,
          reason: 'user.start',
          wantResume: resolvedWantResume,
        },
        machine
      );
      return {};
    }

    // ── stop-agent: delegate to use case ────────────────────────────────
    if (args.type === 'stop-agent' && args.payload?.chatroomId && args.payload?.role) {
      await stopAgentUseCase(ctx, {
        machineId: args.machineId,
        chatroomId: args.payload.chatroomId,
        role: args.payload.role,
        userId: userId,
        reason: args.payload.reason ?? 'user.stop',
      });
      return {};
    }

    // ── ping / status: emit daemon.ping event to stream ───────────────
    const now = Date.now();
    const pingEventId = await ctx.db.insert('chatroom_eventStream', {
      type: 'daemon.ping',
      machineId: args.machineId,
      timestamp: now,
    });

    return { eventId: pingEventId };
  },
});

/** Records the PID of a spawned agent process in the machine agent config. */
export const updateSpawnedAgent = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    pid: v.optional(v.number()), // null to clear
    model: v.optional(v.string()), // Save model alongside PID for config persistence
    reason: v.optional(v.string()),
    harnessSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }
    await getOwnedMachine(ctx, args.machineId, auth.userId);

    const spawnChatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!spawnChatroom?.teamId) {
      throw new Error('Chatroom has no teamId — cannot look up agent config');
    }

    await assertMachineBelongsToChatroom(ctx, {
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      role: args.role,
      allowNewMachine: false,
    });

    const spawnTeamRoleKey = buildTeamRoleKey(spawnChatroom._id, spawnChatroom.teamId, args.role);
    const config = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', spawnTeamRoleKey))
      .first();

    if (!config || config.machineId !== args.machineId) {
      throw new Error('Agent config not found');
    }

    const now = Date.now();

    await ctx.db.patch('chatroom_teamAgentConfigs', config._id, {
      spawnedAgentPid: args.pid,
      spawnedAt: args.pid ? now : undefined,
      updatedAt: now,
      ...(args.model !== undefined ? { model: args.model } : {}),
    });

    // Write agent.started event and increment restart metric when a new agent is spawning
    if (args.pid != null) {
      // 1. Write agent.started event to event stream
      const harness = config.agentHarness ?? 'opencode';
      const configWorkingDir = config.workingDir ?? '/unknown';
      await ctx.db.insert('chatroom_eventStream', {
        type: 'agent.started',
        chatroomId: args.chatroomId,
        role: args.role,
        machineId: args.machineId,
        agentHarness: harness,
        model: args.model ?? config.model ?? 'unknown',
        workingDir: configWorkingDir,
        pid: args.pid,
        reason: args.reason,
        harnessSessionId: args.harnessSessionId,
        timestamp: now,
      });

      await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.started');

      // 2. Upsert restart metric for this hour bucket
      const model = args.model ?? config.model ?? 'unknown';
      const agentType = harness as string;
      const workingDir = configWorkingDir;
      const hourBucket = Math.floor(now / 3_600_000) * 3_600_000;

      const existingMetric = await ctx.db
        .query('chatroom_agentRestartMetrics')
        .withIndex('by_machine_role_hour', (q) =>
          q.eq('machineId', args.machineId).eq('role', args.role).eq('hourBucket', hourBucket)
        )
        .filter((q) =>
          q.and(
            q.eq(q.field('chatroomId'), args.chatroomId),
            q.eq(q.field('model'), model),
            q.eq(q.field('workingDir'), workingDir),
            q.eq(q.field('agentType'), agentType)
          )
        )
        .first();

      if (existingMetric) {
        await ctx.db.patch('chatroom_agentRestartMetrics', existingMetric._id, {
          count: existingMetric.count + 1,
        });
      } else {
        await ctx.db.insert('chatroom_agentRestartMetrics', {
          machineId: args.machineId,
          role: args.role,
          chatroomId: args.chatroomId,
          workingDir,
          model,
          agentType,
          hourBucket,
          count: 1,
        });
      }
    }

    return { success: true };
  },
});

/** Records an agent exit: emits agent.exited event, clears PID, removes participant, and schedules crash recovery if unintentional. */
export const recordAgentExited = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    pid: v.number(),
    stopReason: v.optional(v.string()),
    stopSignal: v.optional(v.string()),
    exitCode: v.optional(v.number()),
    signal: v.optional(v.string()),
    agentHarness: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // 1. Auth + machine ownership check
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await getOwnedMachine(ctx, args.machineId, auth.userId);

    // 2. Delegate to the agentExited use case (event insert + PID-gated cleanup + participant update)
    await agentExitedUseCase(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
      machineId: args.machineId,
      pid: args.pid,
      stopReason: args.stopReason,
      exitCode: args.exitCode,
      signal: args.signal,
      stopSignal: args.stopSignal,
      agentHarness: args.agentHarness,
    });

    // 3. Release in-flight tasks on unexpected exit (daemon owns agent restarts)
    await onAgentExited(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
      stopReason: args.stopReason,
      agentHarness: args.agentHarness,
    });

    return { success: true };
  },
});

// ─── recordAgent* helpers (used by recordRemote/recordCustom and deprecated shim) ─

async function runRecordRemoteAgentRegistered(
  ctx: MutationCtx,
  args: { sessionId: string; chatroomId: Id<'chatroom_rooms'>; role: string; machineId: string }
): Promise<{ success: true }> {
  const auth = await getSession(ctx, args.sessionId);
  if (!auth) {
    throw new Error('Authentication required');
  }

  const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!chatroom || chatroom.ownerId !== auth.userId) {
    throw new Error('Chatroom not found or access denied');
  }

  await getOwnedMachine(ctx, args.machineId, auth.userId);
  if (chatroom.teamId) {
    const regTeamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, args.role);
    const teamCfgForReg = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', regTeamRoleKey))
      .first();
    if (teamCfgForReg?.machineId) {
      await assertMachineBelongsToChatroom(ctx, {
        chatroomId: args.chatroomId,
        machineId: args.machineId,
        role: args.role,
        allowNewMachine: false,
      });
    }
  }

  const now = Date.now();
  await ctx.db.insert('chatroom_eventStream', {
    type: 'agent.registered',
    chatroomId: args.chatroomId,
    role: args.role,
    agentType: 'remote' as const,
    machineId: args.machineId,
    timestamp: now,
  });
  await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.registered');
  return { success: true };
}

async function runRecordCustomAgentRegistered(
  ctx: MutationCtx,
  args: {
    sessionId: string;
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    allowTypeChange?: boolean;
  }
): Promise<{ success: true }> {
  const auth = await getSession(ctx, args.sessionId);
  if (!auth) {
    throw new Error('Authentication required');
  }

  const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!chatroom) throw new Error('Chatroom not found');
  if (chatroom.ownerId !== auth.userId) {
    throw new Error('Not authorized to modify team agent configs for this chatroom');
  }

  if (!chatroom.teamId) {
    throw new ConvexError({
      code: 'CHATROOM_NO_TEAM_ID',
      message: 'Chatroom has no teamId — cannot build agent config key',
    });
  }
  const teamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, args.role);

  const existing = await ctx.db
    .query('chatroom_teamAgentConfigs')
    .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
    .first();

  // Prevent silent un-binding of a machine via custom registration. Switching
  // a role from a machine-bound (remote) config to custom clears `machineId`,
  // which would bypass the assertMachineBelongsToChatroom invariant on a
  // subsequent remote re-registration. Require explicit opt-in.
  if (existing?.machineId && args.allowTypeChange !== true) {
    throw new Error(
      `Role "${args.role}" is currently bound to machine ${existing.machineId}. ` +
        `Pass allowTypeChange: true to switch this role to a custom agent.`
    );
  }

  const now = Date.now();
  const nextConfig = {
    teamRoleKey,
    chatroomId: args.chatroomId,
    role: args.role,
    type: 'custom' as const,
    machineId: undefined,
    agentHarness: undefined,
    model: undefined,
    workingDir: undefined,
    updatedAt: now,
    desiredState: 'running' as const,
  };

  if (existing) {
    await ctx.db.patch('chatroom_teamAgentConfigs', existing._id, nextConfig);
  } else {
    await deleteStaleTeamAgentConfigs(ctx, teamRoleKey);
    await ctx.db.insert('chatroom_teamAgentConfigs', {
      ...nextConfig,
      createdAt: now,
    });
  }

  await ensureOnlyAgentForRole(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
    excludeMachineId: undefined,
  });

  await ctx.db.insert('chatroom_eventStream', {
    type: 'agent.registered',
    chatroomId: args.chatroomId,
    role: args.role,
    agentType: 'custom' as const,
    machineId: undefined,
    timestamp: now,
  });
  await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.registered', 'running');

  return { success: true };
}

/** Records remote CLI agent registration: requires a registered machine and enforces team binding invariants. */
export const recordRemoteAgentRegistered = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    // Enforced in runRecordRemoteAgentRegistered via getSession
    return runRecordRemoteAgentRegistered(ctx, {
      sessionId: args.sessionId,
      chatroomId: args.chatroomId,
      role: args.role,
      machineId: args.machineId,
    });
  },
});

/** Records custom (non-daemon) agent registration: team config + agent.registered event. */
export const recordCustomAgentRegistered = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    /**
     * Required to switch a role from a machine-bound (remote) config to custom.
     * Without this, the mutation rejects when an existing remote binding would be
     * silently cleared — see assertMachineBelongsToChatroom invariant.
     */
    allowTypeChange: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Enforced in runRecordCustomAgentRegistered via getSession
    return runRecordCustomAgentRegistered(ctx, {
      sessionId: args.sessionId,
      chatroomId: args.chatroomId,
      role: args.role,
      allowTypeChange: args.allowTypeChange,
    });
  },
});

/**
 * @deprecated Use {@link recordRemoteAgentRegistered} or {@link recordCustomAgentRegistered} instead.
 * Thin shim; emits a console warning when invoked. Signature preserved for existing clients.
 *
 * Scheduled for removal after one release cycle — see PR #433 follow-up (b).
 * External CLI versions may still call this mutation, so do not remove without a
 * deprecation window and release-notes callout.
 */
export const recordAgentRegistered = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    agentType: agentTypeValidator,
    machineId: v.optional(v.string()),
    /** Forwards to recordCustomAgentRegistered when agentType === 'custom'. */
    allowTypeChange: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Enforced in runRecord* via getSession
    console.warn(
      '[chatroom] machines.recordAgentRegistered is deprecated; use recordRemoteAgentRegistered (remote) or recordCustomAgentRegistered (custom).'
    );
    if (args.agentType === 'remote') {
      if (!args.machineId) {
        throw new Error('machineId is required for remote agent registration');
      }
      return runRecordRemoteAgentRegistered(ctx, {
        sessionId: args.sessionId,
        chatroomId: args.chatroomId,
        role: args.role,
        machineId: args.machineId,
      });
    }
    return runRecordCustomAgentRegistered(ctx, {
      sessionId: args.sessionId,
      chatroomId: args.chatroomId,
      role: args.role,
      allowTypeChange: args.allowTypeChange,
    });
  },
});

/** Writes a daemon.pong event in response to a daemon.ping event. */
export const ackPing = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    pingEventId: v.id('chatroom_eventStream'),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }

    const machine = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    if (!machine || machine.userId !== auth.userId) {
      throw new Error('Machine not found or not owned by user');
    }

    await ctx.db.insert('chatroom_eventStream', {
      type: 'daemon.pong',
      machineId: args.machineId,
      pingEventId: args.pingEventId,
      timestamp: Date.now(),
    });
  },
});

/**
 * Requests an immediate git state refresh for a workspace.
 *
 * Inserts a daemon.gitRefresh event into chatroom_eventStream.
 * The daemon receives it via its live WebSocket subscription and responds
 * by re-running pushGitState for the specified workspace.
 */
export const requestGitRefresh = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    workingDir: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }
    const userId = auth.userId;
    await getOwnedMachine(ctx, args.machineId, userId);

    await ctx.db.insert('chatroom_eventStream', {
      type: 'daemon.gitRefresh',
      machineId: args.machineId,
      workingDir: args.workingDir,
      timestamp: Date.now(),
    });
  },
});

// ============================================================================
// TEAM AGENT CONFIGS
// Team-level agent configuration for auto-restart decisions
// ============================================================================

/** Upserts team agent configuration for a chatroom+role and emits an agent.registered event. */
export const saveTeamAgentConfig = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    type: agentTypeValidator,
    // Remote-specific fields (expected when type === 'remote')
    machineId: v.optional(v.string()),
    agentHarness: v.optional(agentHarnessValidator),
    model: v.optional(v.string()),
    workingDir: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }

    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom) throw new Error('Chatroom not found');
    if (chatroom.ownerId !== auth.userId) {
      throw new Error('Not authorized to modify team agent configs for this chatroom');
    }

    if (!chatroom.teamId) {
      throw new ConvexError({
        code: 'CHATROOM_NO_TEAM_ID',
        message: 'Chatroom has no teamId — cannot build agent config key',
      });
    }
    const teamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, args.role);

    // Upsert by teamRoleKey
    const existing = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
      .first();

    const now = Date.now();
    // Preserve existing model if the new value is undefined (e.g. register-agent doesn't pass model)
    const resolvedModel = args.type === 'remote' ? (args.model ?? existing?.model) : undefined;
    // Preserve existing agentHarness if the new value is undefined (e.g. register-agent doesn't pass agentHarness)
    const resolvedAgentHarness =
      args.type === 'remote' ? (args.agentHarness ?? existing?.agentHarness) : undefined;

    const config = {
      teamRoleKey,
      chatroomId: args.chatroomId,
      role: args.role,
      type: args.type,
      machineId: args.type === 'remote' ? args.machineId : undefined,
      agentHarness: resolvedAgentHarness,
      model: resolvedModel,
      workingDir: args.type === 'remote' ? args.workingDir : undefined,
      updatedAt: now,
      desiredState: 'running' as const,
    };

    if (existing) {
      await ctx.db.patch('chatroom_teamAgentConfigs', existing._id, config);
    } else {
      await deleteStaleTeamAgentConfigs(ctx, teamRoleKey);
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        ...config,
        createdAt: now,
      });
    }

    await ensureOnlyAgentForRole(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
      excludeMachineId: args.type === 'remote' ? args.machineId : undefined,
    });

    // Emit agent.registered event to the event stream
    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.registered',
      chatroomId: args.chatroomId,
      role: args.role,
      agentType: args.type,
      machineId: args.machineId,
      timestamp: now,
    });
    await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.registered', 'running');

    return { success: true };
  },
});

/** Toggle auto-restart-on-new-context for a team agent config (builder only for now). */
export const setAutoRestartOnNewContext = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new ConvexError({ code: 'NOT_AUTHENTICATED', message: 'Authentication required' });
    }

    if (!roleSupportsAutoRestartOnNewContextSetting(args.role)) {
      throw new ConvexError({
        code: 'INVALID_ROLE',
        message: `Auto restart on new context is not available for role "${args.role}"`,
      });
    }

    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom) {
      throw new ConvexError({ code: 'CHATROOM_NOT_FOUND', message: 'Chatroom not found' });
    }
    if (chatroom.ownerId !== auth.userId) {
      throw new ConvexError({
        code: 'UNAUTHORIZED',
        message: 'Not authorized to modify team agent configs for this chatroom',
      });
    }
    if (!chatroom.teamId) {
      throw new ConvexError({
        code: 'CHATROOM_NO_TEAM_ID',
        message: 'Chatroom has no teamId — cannot build agent config key',
      });
    }

    const teamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, args.role);
    const existing = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch('chatroom_teamAgentConfigs', existing._id, {
        autoRestartOnNewContext: args.enabled,
        updatedAt: now,
      });
    } else {
      await deleteStaleTeamAgentConfigs(ctx, teamRoleKey);
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey,
        chatroomId: args.chatroomId,
        role: args.role,
        type: 'remote',
        autoRestartOnNewContext: args.enabled,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { success: true, enabled: args.enabled };
  },
});

/** Persist reconnect-on-start preference for a team agent config. */
export const setWantResume = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    wantResume: v.boolean(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new ConvexError({ code: 'NOT_AUTHENTICATED', message: 'Authentication required' });
    }

    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom) {
      throw new ConvexError({ code: 'CHATROOM_NOT_FOUND', message: 'Chatroom not found' });
    }
    if (chatroom.ownerId !== auth.userId) {
      throw new ConvexError({
        code: 'UNAUTHORIZED',
        message: 'Not authorized to modify team agent configs for this chatroom',
      });
    }
    if (!chatroom.teamId) {
      throw new ConvexError({
        code: 'CHATROOM_NO_TEAM_ID',
        message: 'Chatroom has no teamId — cannot build agent config key',
      });
    }

    const teamRoleKey = buildTeamRoleKey(chatroom._id, chatroom.teamId, args.role);
    const existing = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', teamRoleKey))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch('chatroom_teamAgentConfigs', existing._id, {
        wantResume: args.wantResume,
        updatedAt: now,
      });
    } else {
      await deleteStaleTeamAgentConfigs(ctx, teamRoleKey);
      await ctx.db.insert('chatroom_teamAgentConfigs', {
        teamRoleKey,
        chatroomId: args.chatroomId,
        role: args.role,
        type: 'remote',
        wantResume: args.wantResume,
        createdAt: now,
        updatedAt: now,
      });
    }

    return { success: true, wantResume: args.wantResume };
  },
});

/** Restart offline remote agents using persisted team config. Called when user sends a message. */
export const restartOfflineAgentsFromConfig = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    return restartOfflineAgentsOnUserMessage(ctx, args.chatroomId);
  },
});

/** Returns all team-level agent configurations for a chatroom. */
export const getTeamAgentConfigs = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return [];
    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom || chatroom.ownerId !== auth.userId) return [];

    return await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
  },
});

/** Returns the model visibility filters for a machine+harness combination, or null if unconfigured. */
export const getMachineModelFilters = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    agentHarness: agentHarnessValidator,
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;

    const accessResult = await checkAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'read-access',
    });
    if (!accessResult.ok) return null;

    const filter = await ctx.db
      .query('chatroom_machineModelFilters')
      .withIndex('by_machine_harness', (q) =>
        q.eq('machineId', args.machineId).eq('agentHarness', args.agentHarness)
      )
      .unique();
    return filter ?? null;
  },
});

/** Upserts model visibility filters (hidden models/providers) for a machine+harness combination. */
export const upsertMachineModelFilters = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    agentHarness: agentHarnessValidator,
    hiddenModels: v.array(v.string()),
    hiddenProviders: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await requireSession(ctx, args.sessionId);
    await requireAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'owner',
    });

    const existing = await ctx.db
      .query('chatroom_machineModelFilters')
      .withIndex('by_machine_harness', (q: any) =>
        q.eq('machineId', args.machineId).eq('agentHarness', args.agentHarness)
      )
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch('chatroom_machineModelFilters', existing._id, {
        hiddenModels: args.hiddenModels,
        hiddenProviders: args.hiddenProviders,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('chatroom_machineModelFilters', {
        machineId: args.machineId,
        agentHarness: args.agentHarness,
        hiddenModels: args.hiddenModels,
        hiddenProviders: args.hiddenProviders,
        updatedAt: now,
      });
    }
  },
});

/** Returns the remote agent running status for every chatroom owned by the authenticated user. */
export const listRemoteAgentRunningStatus = query({
  args: { ...SessionIdArg },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return [];

    const userMachines = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_userId', (q) => q.eq('userId', auth.userId))
      .collect();
    const userMachineIds = new Set(userMachines.map((m) => m.machineId));

    const userChatrooms = await ctx.db
      .query('chatroom_rooms')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', auth.userId))
      .collect();

    const results = await Promise.all(
      userChatrooms.map(async (room) => {
        const configs = await ctx.db
          .query('chatroom_teamAgentConfigs')
          .withIndex('by_chatroom', (q) => q.eq('chatroomId', room._id))
          .collect();

        const userConfigs = configs.filter((c) => c.machineId && userMachineIds.has(c.machineId));

        const runningConfigs = userConfigs
          .filter(
            (c): c is typeof c & { machineId: Id<'chatroom_machines'> } =>
              c.spawnedAgentPid != null && c.machineId != null
          )
          .map((c) => ({ machineId: c.machineId, role: c.role }));

        const remoteAgentStatus: 'running' | 'stopped' | 'none' =
          userConfigs.length === 0 ? 'none' : runningConfigs.length > 0 ? 'running' : 'stopped';

        return {
          chatroomId: room._id as Id<'chatroom_rooms'>,
          remoteAgentStatus,
          runningConfigs,
        };
      })
    );

    return results;
  },
});

/** Returns hourly agent restart counts grouped by harness+model for the given machine/role and time range.
 *
 * Scope modes (mutually exclusive; checked in order):
 *   1. chatroomId provided  → "this chatroom" scope
 *   2. workingDir provided  → "workspace" scope (machineId + workingDir)
 *   3. neither              → "machine-wide" scope (all chatrooms for machineId + role)
 *
 * Returns array sorted by hourBucket ascending. Each element:
 *   { hourBucket: number, byHarnessModel: Record<string, number> }
 *   where hourBucket is the UTC ms timestamp of the start of the hour.
 *   Keys are formatted as "agentType/model" (e.g. "pi/claude-sonnet").
 */
export const getAgentRestartMetrics = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    role: v.string(),
    chatroomId: v.optional(v.id('chatroom_rooms')),
    workingDir: v.optional(v.string()),
    startTime: v.number(),
    endTime: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return [];

    const machineAccessResult = await checkAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'read-access',
    });
    if (!machineAccessResult.ok) return [];

    let startHour = Math.floor(args.startTime / 3_600_000) * 3_600_000;
    const endHour = Math.floor(args.endTime / 3_600_000) * 3_600_000;

    const maxRange = 720 * 3_600_000; // 30 days
    if (endHour - startHour > maxRange) {
      startHour = endHour - maxRange;
    }

    let rows: Doc<'chatroom_agentRestartMetrics'>[];

    if (args.chatroomId != null) {
      const chatroomId = args.chatroomId;
      rows = await ctx.db
        .query('chatroom_agentRestartMetrics')
        .withIndex('by_chatroom_role_hour', (q) =>
          q.eq('chatroomId', chatroomId).eq('role', args.role).gte('hourBucket', startHour)
        )
        .filter((q) =>
          q.and(q.eq(q.field('machineId'), args.machineId), q.lte(q.field('hourBucket'), endHour))
        )
        .collect();
    } else if (args.workingDir != null) {
      const workingDir = args.workingDir;
      rows = await ctx.db
        .query('chatroom_agentRestartMetrics')
        .withIndex('by_workspace_role_hour', (q) =>
          q
            .eq('machineId', args.machineId)
            .eq('workingDir', workingDir)
            .eq('role', args.role)
            .gte('hourBucket', startHour)
        )
        .filter((q) => q.lte(q.field('hourBucket'), endHour))
        .collect();
    } else {
      rows = await ctx.db
        .query('chatroom_agentRestartMetrics')
        .withIndex('by_machine_role_hour', (q) =>
          q.eq('machineId', args.machineId).eq('role', args.role).gte('hourBucket', startHour)
        )
        .filter((q) => q.lte(q.field('hourBucket'), endHour))
        .collect();
    }

    const bucketMap = new Map<number, Record<string, number>>();
    for (const row of rows) {
      const existing = bucketMap.get(row.hourBucket) ?? {};
      const key = `${row.agentType ?? 'unknown'}/${row.model}`;
      existing[key] = (existing[key] ?? 0) + row.count;
      bucketMap.set(row.hourBucket, existing);
    }

    return Array.from(bucketMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([hourBucket, byHarnessModel]) => ({ hourBucket, byHarnessModel }));
  },
});

/** Returns total agent restart counts for the last 1h and 24h,
 *  scoped to a specific chatroom + role + machineId.
 *  Used for the compact inline stats row shown per agent in the panel.
 */
export const getAgentRestartSummary = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    role: v.string(),
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return { count3h: 0, count3d: 0 };

    const machineAccessResult = await checkAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'machine', id: args.machineId },
      permission: 'read-access',
    });
    if (!machineAccessResult.ok) return { count3h: 0, count3d: 0 };

    const now = Date.now();
    const since3h = Math.floor((now - 3 * 3_600_000) / 3_600_000) * 3_600_000;
    const since3d = Math.floor((now - 3 * 24 * 3_600_000) / 3_600_000) * 3_600_000;

    // Query rows for chatroom + role starting from 3d ago
    const rows = await ctx.db
      .query('chatroom_agentRestartMetrics')
      .withIndex('by_chatroom_role_hour', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role).gte('hourBucket', since3d)
      )
      .filter((q) => q.eq(q.field('machineId'), args.machineId))
      .collect();

    let count3h = 0;
    let count3d = 0;
    for (const row of rows) {
      count3d += row.count;
      if (row.hourBucket >= since3h) {
        count3h += row.count;
      }
    }

    return { count3h, count3d };
  },
});

/** Returns restart summary for an agent role within a chatroom, aggregated across all machines. */
export const getAgentRestartSummaryByRole = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return { count3h: 0, count3d: 0 };

    const chatroomAccessResult = await checkAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'chatroom', id: str(args.chatroomId) },
      permission: 'read-access',
    });
    if (!chatroomAccessResult.ok) return { count3h: 0, count3d: 0 };

    const now = Date.now();
    const since3h = Math.floor((now - 3 * 3_600_000) / 3_600_000) * 3_600_000;
    const since3d = Math.floor((now - 3 * 24 * 3_600_000) / 3_600_000) * 3_600_000;

    // Query rows for chatroom + role starting from 3d ago (all machines)
    const rows = await ctx.db
      .query('chatroom_agentRestartMetrics')
      .withIndex('by_chatroom_role_hour', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role).gte('hourBucket', since3d)
      )
      .collect();

    let count3h = 0;
    let count3d = 0;
    for (const row of rows) {
      count3d += row.count;
      if (row.hourBucket >= since3h) {
        count3h += row.count;
      }
    }

    return { count3h, count3d };
  },
});

/** Returns restart summaries for multiple agent roles within a chatroom, aggregated across all machines.
 * This batch query allows parent components to fetch all restart stats in a single subscription
 * instead of N subscriptions for N visible InlineAgentCard components.
 */
export const getAgentRestartSummariesByRoles = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    roles: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      return args.roles.map((role) => ({ role, count3h: 0, count3d: 0 }));
    }

    const chatroomAccessResult = await checkAccess(ctx, {
      accessor: { type: 'user', id: auth.userId },
      resource: { type: 'chatroom', id: str(args.chatroomId) },
      permission: 'read-access',
    });
    if (!chatroomAccessResult.ok) {
      return args.roles.map((role) => ({ role, count3h: 0, count3d: 0 }));
    }

    const now = Date.now();
    const since3h = Math.floor((now - 3 * 3_600_000) / 3_600_000) * 3_600_000;
    const since3d = Math.floor((now - 3 * 24 * 3_600_000) / 3_600_000) * 3_600_000;

    const roleCounts = new Map<string, { count3h: number; count3d: number }>();

    for (const role of args.roles) {
      const rows = await ctx.db
        .query('chatroom_agentRestartMetrics')
        .withIndex('by_chatroom_role_hour', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('role', role).gte('hourBucket', since3d)
        )
        .collect();

      let count3h = 0;
      let count3d = 0;
      for (const row of rows) {
        count3d += row.count;
        if (row.hourBucket >= since3h) {
          count3h += row.count;
        }
      }
      roleCounts.set(role, { count3h, count3d });
    }

    // Return summaries for all requested roles (missing roles get 0 counts)
    return args.roles.map((role) => ({
      role,
      ...(roleCounts.get(role) ?? { count3h: 0, count3d: 0 }),
    }));
  },
});

// ============================================================================
// NEW QUERIES — Phase 3 (use-case wrappers)
// ============================================================================

/** Returns a role-centric view of agent status for a chatroom, merging team + machine configs. */
export const getAgentStatus = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;

    return getAgentStatusForChatroom(ctx, {
      chatroomId: args.chatroomId,
      userId: auth.userId,
    });
  },
});

/** Returns the data needed to populate the "Start Agent" form for a specific role. */
/** Returns the data needed to populate the "Start Agent" form for a specific role. */
export const getAgentStartConfig = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;

    return getAgentConfigForStart(ctx, {
      chatroomId: args.chatroomId,
      role: args.role,
      userId: auth.userId,
    });
  },
});

/** Returns a per-chatroom summary of agent status for all chatrooms owned by the user. */
export const listAgentOverview = query({
  args: {
    ...SessionIdArg,
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return [];

    return listChatroomAgentOverview(ctx, {
      userId: auth.userId,
    });
  },
});

/** Returns agent overview for a single chatroom. Per-chatroom subscription reduces blast radius. */
export const getAgentOverviewForChatroom = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;

    const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!chatroom || chatroom.ownerId !== auth.userId) return null;

    const userMachines = await ctx.db
      .query('chatroom_machines')
      .withIndex('by_userId', (q) => q.eq('userId', auth.userId))
      .collect();
    const machineMap = new Map(userMachines.map((m) => [m.machineId, m]));

    // Read status from materialized machineStatus table
    const statusMap = new Map<string, { daemonConnected: boolean }>();
    for (const machine of userMachines) {
      const machineStatus = await ctx.db
        .query('chatroom_machineStatus')
        .withIndex('by_machineId', (q) => q.eq('machineId', machine.machineId))
        .first();
      statusMap.set(machine.machineId, { daemonConnected: machineStatus?.status === 'online' });
    }

    const allConfigs = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    const currentTeamId = chatroom.teamId;
    const configs = allConfigs.filter((c) => {
      if (!c.machineId || !machineMap.has(c.machineId)) return false;
      if (currentTeamId && c.teamRoleKey) {
        return c.teamRoleKey.includes(`#team_${currentTeamId}#`);
      }
      return true;
    });

    const runningConfigs = configs.filter((c) => {
      if (c.spawnedAgentPid == null || c.machineId == null) return false;
      const status = statusMap.get(c.machineId);
      return status?.daemonConnected === true;
    });

    return {
      chatroomId: args.chatroomId as string,
      agentStatus:
        configs.length === 0
          ? ('none' as const)
          : runningConfigs.length > 0
            ? ('running' as const)
            : ('stopped' as const),
      runningRoles: runningConfigs.map((c) => c.role),
      runningAgents: runningConfigs.map((c) => ({ role: c.role, machineId: c.machineId ?? '' })),
    };
  },
});

// ============================================================================
// DAEMON TASK MONITOR
// Used by the daemon to poll assigned tasks on this machine.
// ============================================================================

/**
 * Assigned-task reconcile snapshot for daemon polls (no task.content in response).
 */
// fallow-ignore-next-line code-duplication
export const listAssignedTasksForReconcile = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return { tasks: [] };

    return listAssignedTasksForReconcileForMachine(ctx, {
      machineId: args.machineId,
      userId: auth.userId,
    });
  },
});

/**
 * Incremental task-monitor signals since an exclusive cursor (reactive subscribe).
 */
export const subscribeAssignedTaskSignalsSince = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    afterKey: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return { items: [], highKey: null, hasMore: false };

    return subscribeAssignedTaskSignalsForMachine(ctx, {
      machineId: args.machineId,
      userId: auth.userId,
      afterKey: args.afterKey,
      limit: args.limit,
    });
  },
});

/**
 * Full assigned task row for a single nudge/inject action (includes task.content).
 */
export const getAssignedTaskForAction = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    taskId: v.id('chatroom_tasks'),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;

    return getAssignedTaskForActionForMachine(ctx, {
      machineId: args.machineId,
      userId: auth.userId,
      taskId: args.taskId,
      role: args.role,
    });
  },
});

// ============================================================================
// DAEMON OBSERVABILITY EVENTS
// Emitted by the daemon to report agent lifecycle events to the event stream.
// ============================================================================

/** Emits an agent.startFailed event when the daemon fails to spawn an agent. */
export const emitAgentStartFailed = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await getOwnedMachine(ctx, args.machineId, auth.userId);

    await assertMachineBelongsToChatroom(ctx, {
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      role: args.role,
      allowNewMachine: false,
    });

    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.startFailed',
      chatroomId: args.chatroomId,
      role: args.role,
      machineId: args.machineId,
      error: args.error,
      timestamp: Date.now(),
    });

    // Update participant status so the UI reflects the failure
    await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.startFailed', 'stopped');

    // Reset desiredState to 'stopped' so AgentRoleView.state doesn't stay stuck at 'starting'
    const failedChatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (failedChatroom?.teamId) {
      const failedTeamRoleKey = buildTeamRoleKey(
        failedChatroom._id,
        failedChatroom.teamId,
        args.role
      );
      const failedConfig = await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) => q.eq('teamRoleKey', failedTeamRoleKey))
        .first();
      if (failedConfig) {
        await ctx.db.patch('chatroom_teamAgentConfigs', failedConfig._id, {
          desiredState: 'stopped',
          updatedAt: Date.now(),
        });
      }
    }

    return { success: true };
  },
});

/** Emits an agent.sessionResumeRequested event when stop→start daemon-memory reconnect begins. */
export const emitSessionResumeRequested = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    agentHarness: v.string(),
    harnessSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await getOwnedMachine(ctx, args.machineId, auth.userId);

    await assertMachineBelongsToChatroom(ctx, {
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      role: args.role,
      allowNewMachine: false,
    });

    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.sessionResumeRequested',
      chatroomId: args.chatroomId,
      role: args.role,
      machineId: args.machineId,
      agentHarness: args.agentHarness,
      harnessSessionId: args.harnessSessionId,
      timestamp: Date.now(),
    });

    await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.sessionResumeRequested');

    return { success: true };
  },
});

/** Emits an agent.sessionResumed event when stop→start daemon-memory reconnect succeeds. */
export const emitSessionResumed = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    harnessSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await getOwnedMachine(ctx, args.machineId, auth.userId);

    await assertMachineBelongsToChatroom(ctx, {
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      role: args.role,
      allowNewMachine: false,
    });

    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.sessionResumed',
      chatroomId: args.chatroomId,
      role: args.role,
      machineId: args.machineId,
      harnessSessionId: args.harnessSessionId,
      timestamp: Date.now(),
    });

    await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.sessionResumed');

    return { success: true };
  },
});

/** Emits an agent.sessionResumeFailed event when stop→start daemon-memory reconnect fails. */
export const emitSessionResumeFailed = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    reason: v.string(),
    harnessSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await getOwnedMachine(ctx, args.machineId, auth.userId);

    await assertMachineBelongsToChatroom(ctx, {
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      role: args.role,
      allowNewMachine: false,
    });

    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.sessionResumeFailed',
      chatroomId: args.chatroomId,
      role: args.role,
      machineId: args.machineId,
      reason: args.reason,
      harnessSessionId: args.harnessSessionId,
      timestamp: Date.now(),
    });

    await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.sessionResumeFailed');

    return { success: true };
  },
});

/** Emits an agent.sessionReopenRetry event for each cursor-sdk crash recovery attempt. */
export const emitSessionReopenRetry = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    attempt: v.number(),
    maxAttempts: v.number(),
    error: v.optional(v.string()),
    harnessSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await getOwnedMachine(ctx, args.machineId, auth.userId);

    await assertMachineBelongsToChatroom(ctx, {
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      role: args.role,
      allowNewMachine: false,
    });

    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.sessionReopenRetry',
      chatroomId: args.chatroomId,
      role: args.role,
      machineId: args.machineId,
      attempt: args.attempt,
      maxAttempts: args.maxAttempts,
      error: args.error,
      harnessSessionId: args.harnessSessionId,
      timestamp: Date.now(),
    });

    await transitionAgentStatus(ctx, args.chatroomId, args.role, 'agent.sessionReopenRetry');

    return { success: true };
  },
});

/** Emits agent.sessionAugmented when task delivery applies session augmentation. */
export const emitSessionAugmented = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    taskId: v.id('chatroom_tasks'),
    mode: v.union(v.literal('none'), v.literal('compact'), v.literal('new_session')),
    newSessionStarted: v.boolean(),
    harnessSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await getOwnedMachine(ctx, args.machineId, auth.userId);

    await assertMachineBelongsToChatroom(ctx, {
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      role: args.role,
      allowNewMachine: false,
    });

    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.sessionAugmented',
      chatroomId: args.chatroomId,
      role: args.role,
      machineId: args.machineId,
      taskId: args.taskId,
      mode: args.mode,
      newSessionStarted: args.newSessionStarted,
      harnessSessionId: args.harnessSessionId,
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

/** Emits agent.sessionCompacted when native harness runs in-session compaction (`session_augmentation=compact`). */
export const emitSessionCompacted = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    taskId: v.id('chatroom_tasks'),
    harnessSessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await getOwnedMachine(ctx, args.machineId, auth.userId);

    await assertMachineBelongsToChatroom(ctx, {
      chatroomId: args.chatroomId,
      machineId: args.machineId,
      role: args.role,
      allowNewMachine: false,
    });

    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.sessionCompacted',
      chatroomId: args.chatroomId,
      role: args.role,
      machineId: args.machineId,
      taskId: args.taskId,
      harnessSessionId: args.harnessSessionId,
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

/** Emits an agent.restartLimitReached event when crash loop protection triggers. */
export const emitRestartLimitReached = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    restartCount: v.number(),
    windowMs: v.number(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await getOwnedMachine(ctx, args.machineId, auth.userId);

    await ctx.db.insert('chatroom_eventStream', {
      type: 'agent.restartLimitReached',
      chatroomId: args.chatroomId,
      role: args.role,
      machineId: args.machineId,
      restartCount: args.restartCount,
      windowMs: args.windowMs,
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Clears spawnedAgentPid on ALL teamAgentConfigs for a machine.
 * Called by the daemon on startup — since the daemon just started fresh,
 * no agents are running on this machine. Stale PIDs from before the restart
 * must be cleared to prevent the UI from showing dead agents as "running".
 *
 * Also updates participant lastStatus to 'agent.exited' for any configs
 * that had a PID, so the UI status label is correct.
 */
export const clearAllSpawnedPids = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) throw new Error('Authentication required');
    await getOwnedMachine(ctx, args.machineId, auth.userId);

    // Find all configs for this machine that have a spawnedAgentPid
    const allConfigs = await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .collect();

    const now = Date.now();
    let clearedCount = 0;

    for (const config of allConfigs) {
      if (config.spawnedAgentPid != null) {
        await ctx.db.patch('chatroom_teamAgentConfigs', config._id, {
          spawnedAgentPid: undefined,
          spawnedAt: undefined,
          updatedAt: now,
        });

        // Update participant status so the UI doesn't show "STARTING" or "WORKING"
        await transitionAgentStatus(ctx, config.chatroomId, config.role, 'agent.exited', undefined);

        clearedCount++;
      }
    }

    return { clearedCount };
  },
});

/**
 * Returns observed chatrooms for a machine — daemon subscribes to drive selective sync.
 * Only returns chatrooms where the frontend has sent a heartbeat within OBSERVATION_TTL_MS.
 */
export const getObservedChatroomsForMachine = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }

    // Verify machine belongs to user
    await getOwnedMachine(ctx, args.machineId, auth.userId);

    const now = Date.now();
    const ttlThreshold = now - OBSERVATION_TTL_MS;

    // Get all workspaces on this machine and build a chatroomId → workingDirs map
    const workspaces = await ctx.db
      .query('chatroom_workspaces')
      .withIndex('by_machine', (q) => q.eq('machineId', args.machineId))
      .collect();

    const chatroomWorkingDirsMap = new Map<Id<'chatroom_rooms'>, string[]>();
    for (const ws of workspaces) {
      if (ws.removedAt) continue;
      const existing = chatroomWorkingDirsMap.get(ws.chatroomId) ?? [];
      existing.push(ws.workingDir);
      chatroomWorkingDirsMap.set(ws.chatroomId, existing);
    }

    // Fetch active observations in a single range query (avoids N+1 per chatroom)
    const activeObservations = await ctx.db
      .query('chatroom_observation')
      .withIndex('by_lastObservedAt', (q) => q.gte('lastObservedAt', ttlThreshold))
      .collect();

    // Build a map from chatroomId → observation record for fast lookup
    const observationMap = new Map<Id<'chatroom_rooms'>, (typeof activeObservations)[number]>();
    for (const obs of activeObservations) {
      observationMap.set(obs.chatroomId, obs);
    }

    // Intersect with this machine's chatrooms
    const result: {
      chatroomId: Id<'chatroom_rooms'>;
      workingDirs: string[];
      lastRefreshedAt: number | null;
    }[] = [];
    for (const [chatroomId, workingDirs] of chatroomWorkingDirsMap) {
      const obs = observationMap.get(chatroomId);
      if (obs) {
        result.push({
          chatroomId,
          workingDirs,
          lastRefreshedAt: obs.lastRefreshedAt ?? null,
        });
      }
    }

    return result;
  },
});
