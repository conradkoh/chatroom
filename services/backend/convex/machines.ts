// fallow-ignore-file code-duplication complexity
/** Convex functions for machine registration, agent config, and remote command dispatch. */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { mutation, query } from './_generated/server';
import { getSession, requireSession } from './auth/session';
import { str } from './utils/types';
import {
  agentActivityFactValidator,
  agentLifecycleFactValidator,
} from './validators/agent_lifecycle_fact';
import { validateWorkingDir } from './workspacePathSecurity';
import { DAEMON_LIVENESS_WRITE_INTERVAL_MS } from '../config/reliability';
import { checkAccess, requireAccess } from '../modules/auth/accessCheck';
import { getMachineOwner, requireMachineOwner } from './auth/cli/machineAccess';
import { agentHarnessValidator } from './schema';
import {
  AgentStartReasonEnum,
  machineCommandTypeValidator,
  type AgentHarness,
} from '../src/domain/entities/agent';
import { applyAgentActivityHeartbeat } from '../src/domain/usecase/agent/apply-agent-activity-heartbeat';
import { assertMachineBelongsToChatroom } from '../src/domain/usecase/agent/assert-machine-belongs-to-chatroom';
import { authorizeAgentStart as authorizeAgentStartUseCase } from '../src/domain/usecase/agent/authorize-agent-start';
import { getAgentConfigForStart } from '../src/domain/usecase/agent/get-agent-config-for-start';
import { getLastSentLaunchRequestForRole } from '../src/domain/usecase/agent/get-last-sent-launch-request';
import { projectAgentLifecycleFact as projectAgentLifecycleFactUseCase } from '../src/domain/usecase/agent/project-agent-lifecycle-fact';
import { requestAgentRestart } from '../src/domain/usecase/agent/request-agent-restart';
import { startAgent as startAgentUseCase } from '../src/domain/usecase/agent/start-agent';
import { enqueueMachineCommand } from '../src/domain/usecase/machine/enqueue-machine-command';
import { getAssignedTaskForAction as getAssignedTaskForActionForMachine } from '../src/domain/usecase/machine/get-assigned-task-for-action';
import { getActiveTeamStructure } from '../src/domain/usecase/team/active-team-structure';

// ─── Shared Helpers ──────────────────────────────────────────────────

/**
 * Default start-agent policy: first bind (no machine on last-sent request) allows omitted flag;
 * once bound, switching machines requires explicit `allowNewMachine: true`.
 */
function resolveAllowNewMachineForStart(
  payload: { allowNewMachine?: boolean | undefined } | undefined,
  existingConfig: { machineId?: string | undefined } | null
): boolean {
  if (payload?.allowNewMachine !== undefined) return payload.allowNewMachine;
  return !existingConfig?.machineId;
}

async function getCurrentLastSentLaunchRequest(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  workspaceId?: Id<'chatroom_workspaces'>
) {
  const activeStructure = await getActiveTeamStructure(ctx, chatroomId);
  const structureId = activeStructure?.teamStructureId;
  if (!structureId) return null;
  return getLastSentLaunchRequestForRole(ctx, {
    chatroomId,
    role,
    teamStructureId: structureId,
    ...(workspaceId ? { workspaceId } : {}),
  });
}

/** Convert a Convex Id to a plain string for the pure-function layer. */

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
// MACHINE CAPABILITIES — DAEMON-FED READ MODEL
// ============================================================================

/**
 * Upsert the per-machine daemon capability snapshot.
 *
 * One row per machine; the whole Record<harness, models[]> lives in a single row.
 * Skips the write when availableModels is undefined (don't clobber existing data
 * with an empty/absent payload from old daemons that don't send models).
 * Also skips when the content is structurally identical to the existing row
 * (JSON.stringify deep-equality) — no-op writes still invalidate Convex
 * subscriptions, so we must suppress them to achieve the bandwidth goal.
 */
async function upsertMachineCapabilities(
  ctx: MutationCtx,
  machineId: string,
  input: {
    lastSeenAt?: number | undefined;
    availableHarnesses?: readonly AgentHarness[] | undefined;
    harnessVersions?: Record<string, { version: string; major: number }> | undefined;
    availableModels?: Record<string, string[]> | undefined;
  }
): Promise<void> {
  if (
    input.availableModels === undefined &&
    input.availableHarnesses === undefined &&
    input.harnessVersions === undefined
  ) {
    // Don't clobber existing models when caller didn't supply them.
    return;
  }

  const existing = await ctx.db
    .query('chatroom_machineCapabilities')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();

  if (existing) {
    // Skip write if content is identical — prevents subscription invalidation churn.
    // JSON.stringify is safe here: JS object key order is insertion-order-stable and
    // daemons write the same harness key order on every call. A true reordering would
    // indicate a genuine harness-list change and trigger a real write (correct behaviour).
    if (
      (input.lastSeenAt === undefined || existing.lastSeenAt === input.lastSeenAt) &&
      (input.availableModels === undefined ||
        JSON.stringify(existing.availableModels) === JSON.stringify(input.availableModels)) &&
      (input.availableHarnesses === undefined ||
        JSON.stringify(existing.availableHarnesses) === JSON.stringify(input.availableHarnesses)) &&
      (input.harnessVersions === undefined ||
        JSON.stringify(existing.harnessVersions) === JSON.stringify(input.harnessVersions))
    ) {
      return;
    }
    await ctx.db.patch('chatroom_machineCapabilities', existing._id, {
      ...(input.lastSeenAt !== undefined ? { lastSeenAt: input.lastSeenAt } : {}),
      ...(input.availableModels !== undefined ? { availableModels: input.availableModels } : {}),
      ...(input.availableHarnesses !== undefined
        ? { availableHarnesses: [...input.availableHarnesses] }
        : {}),
      ...(input.harnessVersions !== undefined ? { harnessVersions: input.harnessVersions } : {}),
      updatedAt: Date.now(),
    });
  } else {
    await ctx.db.insert('chatroom_machineCapabilities', {
      machineId,
      ...(input.lastSeenAt !== undefined ? { lastSeenAt: input.lastSeenAt } : {}),
      ...(input.availableModels !== undefined ? { availableModels: input.availableModels } : {}),
      ...(input.availableHarnesses !== undefined
        ? { availableHarnesses: [...input.availableHarnesses] }
        : {}),
      ...(input.harnessVersions !== undefined ? { harnessVersions: input.harnessVersions } : {}),
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

      // Update stable machine identity. Volatile capabilities live in the
      // daemon-fed capability read model.
      await ctx.db.patch('chatroom_machines', existing._id, {
        hostname: args.hostname,
        os: args.os,
      });
      await upsertMachineCapabilities(ctx, args.machineId, {
        lastSeenAt: now,
        availableHarnesses: args.availableHarnesses,
        harnessVersions: args.harnessVersions,
        availableModels: args.availableModels,
      });

      return { machineId: args.machineId, isNew: false };
    }

    // Create new machine registration. Capabilities are stored separately so
    // listMachines remains a lightweight stable-identity query.
    await ctx.db.insert('chatroom_machines', {
      machineId: args.machineId,
      userId: userId,
      hostname: args.hostname,
      os: args.os,
      registeredAt: now,
    });
    await upsertMachineCapabilities(ctx, args.machineId, {
      lastSeenAt: now,
      availableHarnesses: args.availableHarnesses,
      harnessVersions: args.harnessVersions,
      availableModels: args.availableModels,
    });

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

    await upsertMachineCapabilities(ctx, args.machineId, {
      lastSeenAt: Date.now(),
      availableHarnesses: args.availableHarnesses,
      harnessVersions: args.harnessVersions,
      availableModels: args.availableModels,
    });
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

/** Enqueue a capabilities refresh after the caller has authorized the chatroom. */
export async function enqueueCapabilitiesRefresh(
  ctx: MutationCtx,
  args: { userId: Id<'users'>; chatroomId: Id<'chatroom_rooms'>; machineId: string }
) {
  const now = Date.now();
  const COOLDOWN_MS = 10 * 1000;

  const machine = await ctx.db
    .query('chatroom_machines')
    .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
    .first();

  if (!machine || machine.userId !== args.userId) {
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
    userId: args.userId,
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

  await enqueueMachineCommand(ctx, {
    machineId: machine.machineId,
    now,
    command: { type: 'daemon.refreshCapabilities', batchId },
  });

  await ctx.db.patch('chatroom_machines', machine._id, {
    lastCapabilitiesRefreshRequestedAt: now,
  });

  return { applied: true as const, batchId };
}

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

    return enqueueCapabilitiesRefresh(ctx, {
      userId,
      chatroomId: args.chatroomId,
      machineId: args.machineId,
    });
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
      machines: await Promise.all(
        machines.map(async (m) => {
          const capabilities = await ctx.db
            .query('chatroom_machineCapabilities')
            .withIndex('by_machineId', (q) => q.eq('machineId', m.machineId))
            .first();
          return {
            machineId: m.machineId,
            hostname: m.hostname,
            alias: m.alias,
            os: m.os,
            availableHarnesses: capabilities?.availableHarnesses ?? [],
            harnessVersions: capabilities?.harnessVersions ?? {},
            registeredAt: m.registeredAt,
          };
        })
      ),
    };
  },
});

/**
 * Per-machine available model list from the daemon capability read model.
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

    const newRow = await ctx.db
      .query('chatroom_machineCapabilities')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();
    if (newRow?.availableModels) {
      return { availableModels: newRow.availableModels };
    }
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
      return { connected: false };
    }

    // Read status from materialized machineStatus table
    const machineStatus = await ctx.db
      .query('chatroom_machineStatus')
      .withIndex('by_machineId', (q) => q.eq('machineId', args.machineId))
      .first();

    return { connected: machineStatus?.status === 'online' };
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
    }[] = [];

    for (const machineId of machineIds) {
      const auth = await getMachineOwner(ctx, args.sessionId, machineId);
      if (!auth) {
        statuses.push({ machineId, connected: false });
        continue;
      }

      const machineStatus = await ctx.db
        .query('chatroom_machineStatus')
        .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
        .first();

      statuses.push({
        machineId,
        connected: machineStatus?.status === 'online',
      });
    }

    return { statuses };
  },
});

// COMMAND MANAGEMENT
// ============================================================================

/** Marks a daemon online during startup. */
export const markDaemonOnline = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    await setDaemonStatus(ctx, args.machineId, 'online');
    return { success: true };
  },
});

/** Marks a daemon offline during graceful shutdown. */
export const markDaemonOffline = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    await setDaemonStatus(ctx, args.machineId, 'offline');
    return { success: true };
  },
});

async function setDaemonStatus(
  ctx: MutationCtx,
  machineId: string,
  desiredStatus: 'online' | 'offline'
): Promise<void> {
  const now = Date.now();
  const existingLiveness = await ctx.db
    .query('chatroom_machineLiveness')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();

  if (existingLiveness) {
    await ctx.db.patch('chatroom_machineLiveness', existingLiveness._id, {
      lastSeenAt: now,
    });
  } else {
    await ctx.db.insert('chatroom_machineLiveness', {
      machineId,
      lastSeenAt: now,
    });
  }

  const machineStatus = await ctx.db
    .query('chatroom_machineStatus')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .first();

  if (!machineStatus) {
    await ctx.db.insert('chatroom_machineStatus', {
      machineId,
      status: desiredStatus,
      lastTransitionAt: now,
    });
  } else if (machineStatus.status !== desiredStatus) {
    await ctx.db.patch('chatroom_machineStatus', machineStatus._id, {
      status: desiredStatus,
      lastTransitionAt: now,
    });
  }
}

async function upsertDaemonLiveness(
  ctx: MutationCtx,
  machineId: string,
  now: number,
  existing: Doc<'chatroom_machineLiveness'> | null
): Promise<void> {
  if (existing) {
    const livenessStale = now - existing.lastSeenAt >= DAEMON_LIVENESS_WRITE_INTERVAL_MS;
    if (!livenessStale) return;
    await ctx.db.patch('chatroom_machineLiveness', existing._id, {
      ...(livenessStale ? { lastSeenAt: now } : {}),
    });
    return;
  }
  await ctx.db.insert('chatroom_machineLiveness', {
    machineId,
    lastSeenAt: now,
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
  const alreadyOnline = machineStatus?.status === 'online';
  return livenessFresh && alreadyOnline;
}

/** Updates lastSeenAt for liveness detection and keeps machine status online. */
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
      v.literal('open-cursor'),
      v.literal('open-daemon-logs'),
      v.literal('git-discard-file'),
      v.literal('git-discard-all'),
      v.literal('git-pull'),
      v.literal('git-push'),
      v.literal('git-sync')
    ),
    workingDir: v.string(),
    chatroomId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }
    const userId = auth.userId;
    await getOwnedMachine(ctx, args.machineId, userId);

    validateWorkingDir(args.workingDir);

    await enqueueMachineCommand(ctx, {
      machineId: args.machineId,
      command: {
        type: 'daemon.localAction',
        action: args.action,
        workingDir: args.workingDir,
        ...(args.chatroomId !== undefined ? { chatroomId: args.chatroomId } : {}),
      },
    });
    return { success: true };
  },
});

/** Request a native folder picker on a connected machine's daemon (setup wizard). */
export const requestFolderPicker = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }
    const userId = auth.userId;
    await getOwnedMachine(ctx, args.machineId, userId);

    const now = Date.now();
    const requestId = await ctx.db.insert('chatroom_folderPickerRequests', {
      userId,
      machineId: args.machineId,
      status: 'pending',
      createdAt: now,
    });

    await enqueueMachineCommand(ctx, {
      machineId: args.machineId,
      now,
      command: { type: 'daemon.pickFolder', requestId },
    });

    return { requestId };
  },
});

/** Poll folder picker request status from the webapp. */
export const getFolderPickerRequest = query({
  args: {
    ...SessionIdArg,
    requestId: v.id('chatroom_folderPickerRequests'),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) return null;
    const request = await ctx.db.get('chatroom_folderPickerRequests', args.requestId);
    if (!request || request.userId !== auth.userId) return null;
    return request;
  },
});

/** Called by the CLI daemon after handling `daemon.pickFolder`. */
export const reportFolderPickerResult = mutation({
  args: {
    ...SessionIdArg,
    requestId: v.id('chatroom_folderPickerRequests'),
    machineId: v.string(),
    status: v.union(v.literal('completed'), v.literal('cancelled'), v.literal('failed')),
    selectedPath: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const auth = await getSession(ctx, args.sessionId);
    if (!auth) {
      throw new Error('Authentication required');
    }
    const machine = await getOwnedMachine(ctx, args.machineId, auth.userId);

    const request = await ctx.db.get('chatroom_folderPickerRequests', args.requestId);
    if (!request) {
      throw new Error('Folder picker request not found');
    }
    if (request.machineId !== machine.machineId) {
      throw new Error('Folder picker request does not belong to this machine');
    }
    if (request.status !== 'pending') {
      return { ok: true as const, duplicate: true as const };
    }

    if (args.selectedPath) {
      validateWorkingDir(args.selectedPath);
    }

    await ctx.db.patch('chatroom_folderPickerRequests', args.requestId, {
      status: args.status,
      selectedPath: args.selectedPath,
      errorMessage: args.errorMessage,
      completedAt: Date.now(),
    });

    return { ok: true as const };
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
        workspaceId: v.optional(v.id('chatroom_workspaces')),
        role: v.optional(v.string()),
        model: v.optional(v.string()),
        // For first-time starts when no agent config exists:
        agentHarness: v.optional(agentHarnessValidator),
        workingDir: v.optional(v.string()),
        /** When true, allows binding to a new machine or switching from a previously bound machine. */
        allowNewMachine: v.optional(v.boolean()),
        /** When true (default), resume from the daemon's last session on first launch. */
        wantResume: v.optional(v.boolean()),
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
      // Read the latest submitted request for fallback values when payload is incomplete.
      const existingConfig = await getCurrentLastSentLaunchRequest(
        ctx,
        args.payload.chatroomId,
        args.payload.role,
        args.payload.workspaceId
      );

      const resolvedModel =
        args.payload.model ??
        (existingConfig?.agentType === 'remote' ? existingConfig.model : undefined);
      const resolvedHarness =
        args.payload.agentHarness ??
        (existingConfig?.agentType === 'remote' ? existingConfig.agentHarness : undefined);
      const resolvedWorkingDir =
        args.payload.workingDir ??
        (existingConfig?.agentType === 'remote' ? existingConfig.workingDir : undefined);
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
          workspaceId: args.payload.workspaceId,
          role: args.payload.role,
          userId: userId,
          model: resolvedModel,
          agentHarness: resolvedHarness,
          workingDir: resolvedWorkingDir,
          reason: AgentStartReasonEnum['user.start'],
          wantResume: args.payload.wantResume ?? false,
        },
        machine
      );
      return {};
    }

    // ── restart-agent: delegate to use case ─────────────────────────────
    if (args.type === 'restart-agent' && args.payload?.chatroomId && args.payload?.role) {
      const { model, agentHarness, workingDir } = args.payload;
      if (!model || !agentHarness || !workingDir) {
        throw new Error(
          'Cannot restart agent: model, agentHarness, and workingDir are required in the payload.'
        );
      }

      const existingConfig = await getCurrentLastSentLaunchRequest(
        ctx,
        args.payload.chatroomId,
        args.payload.role,
        args.payload.workspaceId
      );

      const allowNewMachine = resolveAllowNewMachineForStart(args.payload, existingConfig);
      await assertMachineBelongsToChatroom(ctx, {
        chatroomId: args.payload.chatroomId,
        machineId: args.machineId,
        role: args.payload.role,
        allowNewMachine,
      });

      const result = await requestAgentRestart(
        ctx,
        {
          chatroomId: args.payload.chatroomId,
          workspaceId: args.payload.workspaceId,
          role: args.payload.role,
          requestedBy: userId,
          request: {
            reason: AgentStartReasonEnum['user.restart'],
            overrides: {
              machineId: args.machineId,
              model,
              agentHarness,
              workingDir,
            },
          },
        },
        machine
      );
      if (result.status === 'skipped') {
        throw new Error(`Cannot restart agent: ${result.reason}`);
      }
      return {};
    }

    // ── ping / status: emit daemon.ping event to stream ───────────────
    const now = Date.now();
    const pingEventId = await enqueueMachineCommand(ctx, {
      machineId: args.machineId,
      now,
      command: { type: 'daemon.ping' },
    });

    return { eventId: pingEventId };
  },
});

export const authorizeAgentStart = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    taskId: v.optional(v.id('chatroom_tasks')),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return authorizeAgentStartUseCase(ctx, args);
  },
});

export const projectAgentLifecycleFact = mutation({
  args: { ...SessionIdArg, machineId: v.string(), fact: agentLifecycleFactValidator },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return projectAgentLifecycleFactUseCase(ctx, { machineId: args.machineId, fact: args.fact });
  },
});

/** Records a daemon activity heartbeat without entering the heavier lifecycle dispatcher. */
export const recordAgentActivityHeartbeat = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    fact: agentActivityFactValidator,
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    await applyAgentActivityHeartbeat(ctx, args.fact);
    return { success: true };
  },
});

/**
 * Requests an immediate git state refresh for a workspace.
 *
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

    await enqueueMachineCommand(ctx, {
      machineId: args.machineId,
      command: { type: 'daemon.gitRefresh', workingDir: args.workingDir },
    });
  },
});

// ============================================================================
// TEAM AGENT CONFIGS
// Team-level agent configuration for auto-restart decisions
// ============================================================================

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
      .withIndex('by_machine_harness', (q) =>
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

// Re-export machine config favorites queries/mutations
export { getMachineConfigFavorites, setMachineConfigFavorites } from './machineConfigFavorites';
