/**
 * Subscribes to pending direct-harness commands via Convex WS and processes
 * them sequentially.
 *
 * Each command is idempotent by `_id`: once processed it's added to a dedup
 * set so it won't be processed again (even if the daemon restarts, the
 * command status is updated to done/failed).
 *
 * Commands older than DIRECT_HARNESS_COMMAND_TTL_MS are discarded (marked
 * as failed) without processing — they represent stale requests that were
 * created before the daemon came online.
 */

import type { ConvexClient } from 'convex/browser';

import type { DaemonContext } from '../types.js';
import { api } from '../../../../api.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Commands pending longer than this TTL are discarded as stale. */
const DIRECT_HARNESS_COMMAND_TTL_MS = 60_000;

// ─── Convex shape types ──────────────────────────────────────────────────────

/** Shape of a command row from listPendingCommands. */
interface PendingCommand {
  _id: string;
  _creationTime: number;
  machineId: string;
  workspaceId: string;
  type: 'refreshCapabilities';
  refreshCapabilities?: { initiatedBy: string };
  status: string;
  createdAt: number;
  completedAt?: number;
  errorMessage?: string;
}

/** The command payload for refreshCapabilities. */
interface RefreshCapabilitiesPayload {
  initiatedBy: string;
}

// ─── Subscriber ──────────────────────────────────────────────────────────────

export function startCommandSubscriber(
  ctx: DaemonContext,
  wsClient: ConvexClient
): { stop: () => void } {
  /** Dedup set of command _id values already processed or in-flight. */
  const processed = new Set<string>();
  let processing = false;
  let pendingDrain = false;

  const runDrain = () => {
    if (processing) {
      // A drain is already running; schedule another pass when it finishes
      pendingDrain = true;
      return;
    }
    processing = true;
    pendingDrain = false;
    void drain(ctx, processed).finally(() => {
      processing = false;
      // If a notification arrived while we were draining, run again immediately
      if (pendingDrain) runDrain();
    });
  };

  const unsub = wsClient.onUpdate(
    api.daemon.directHarness.commands.listPendingCommands,
    { sessionId: ctx.sessionId, machineId: ctx.machineId },
    () => runDrain(),
    (err: unknown) => {
      console.warn(
        '[direct-harness] Command subscription error:',
        err instanceof Error ? err.message : String(err)
      );
    }
  );

  return { stop: unsub };
}

// ─── Drain loop ──────────────────────────────────────────────────────────────

/**
 * Fetch all pending commands and process each one sequentially.
 * Commands are processed one at a time to avoid race conditions on shared
 * state (e.g., two capabilities refreshes in flight).
 */
async function drain(
  ctx: DaemonContext,
  processed: Set<string>
): Promise<void> {
  const pending = (await ctx.deps.backend.query(
    api.daemon.directHarness.commands.listPendingCommands,
    { sessionId: ctx.sessionId, machineId: ctx.machineId }
  )) as PendingCommand[] | null;

  if (!pending || pending.length === 0) return;

  const now = Date.now();

  for (const cmd of pending) {
    // Skip already-processed (idempotency key = _id)
    if (processed.has(cmd._id)) continue;
    processed.add(cmd._id);

    try {
      // TTL check: discard stale commands
      if (now - cmd.createdAt > DIRECT_HARNESS_COMMAND_TTL_MS) {
        console.log(
          `[direct-harness] Discarding stale command ${cmd._id} (type=${cmd.type}, age=${now - cmd.createdAt}ms)`
        );
        await markFailed(ctx, cmd._id, 'Command expired (TTL)');
        continue;
      }

      // Process based on type
      switch (cmd.type) {
        case 'refreshCapabilities':
          await handleRefreshCapabilities(ctx, cmd);
          break;
        default:
          await markFailed(ctx, cmd._id, `Unknown command type: ${cmd.type}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[direct-harness] Command ${cmd._id} failed: ${message}`);
      await markFailed(ctx, cmd._id, message).catch(() => {});
    }
  }
}

// ─── Command handlers ─────────────────────────────────────────────────────────

/**
 * Handle a refreshCapabilities command.
 *
 * TODO: wire into the real capabilities publish flow once implemented.
 * Currently just marks the command as done.
 */
async function handleRefreshCapabilities(
  ctx: DaemonContext,
  cmd: PendingCommand
): Promise<void> {
  const payload = cmd.refreshCapabilities as RefreshCapabilitiesPayload | undefined;
  console.log(
    `[direct-harness] Processing refreshCapabilities for workspace=${cmd.workspaceId}` +
      (payload ? ` (initiatedBy=${payload.initiatedBy})` : '')
  );

  // TODO: collect and publish capabilities from running harnesses
  // For now, just mark as done to acknowledge the command.
  await ctx.deps.backend.mutation(
    api.daemon.directHarness.commands.updateCommandStatus,
    {
      sessionId: ctx.sessionId,
      commandId: cmd._id,
      status: 'done',
    }
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mark a command as failed with an error message. */
async function markFailed(
  ctx: DaemonContext,
  commandId: string,
  errorMessage: string
): Promise<void> {
  await ctx.deps.backend.mutation(
    api.daemon.directHarness.commands.updateCommandStatus,
    {
      sessionId: ctx.sessionId,
      commandId,
      status: 'failed',
      errorMessage,
    }
  );
}
