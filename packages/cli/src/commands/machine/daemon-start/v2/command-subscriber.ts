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

import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import { updateCapabilities } from '../../../../domain/direct-harness/usecases/update-capabilities.js';
import type { CapabilitiesPublisher } from '../../../../domain/direct-harness/ports/capabilities-publisher.js';
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

// ─── Deps ────────────────────────────────────────────────────────────────────

export interface CommandSubscriberDeps {
  /** Running BoundHarness instances keyed by workspaceId. */
  readonly harnesses: Map<string, BoundHarness>;
  /** Publishes capability snapshots to the machine registry. */
  readonly publisher: CapabilitiesPublisher;
}

// ─── Subscriber ──────────────────────────────────────────────────────────────

export function startCommandSubscriber(
  ctx: DaemonContext,
  wsClient: ConvexClient,
  deps: CommandSubscriberDeps
): { stop: () => void } {
  /** Dedup set of command _id values already processed or in-flight. */
  const processed = new Set<string>();
  let processing = false;
  let pendingDrain = false;

  const runDrain = () => {
    if (processing) {
      pendingDrain = true;
      return;
    }
    processing = true;
    pendingDrain = false;
    void drain(ctx, deps, processed).finally(() => {
      processing = false;
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
  deps: CommandSubscriberDeps,
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
          await handleRefreshCapabilities(ctx, deps, cmd);
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

async function handleRefreshCapabilities(
  ctx: DaemonContext,
  deps: CommandSubscriberDeps,
  cmd: PendingCommand
): Promise<void> {
  const payload = cmd.refreshCapabilities as RefreshCapabilitiesPayload | undefined;
  console.log(
    `[direct-harness] Processing refreshCapabilities for workspace=${cmd.workspaceId}` +
      (payload ? ` (initiatedBy=${payload.initiatedBy})` : '')
  );

  const harness = deps.harnesses.get(cmd.workspaceId);
  if (!harness) {
    console.warn(
      `[direct-harness] No running harness for workspace=${cmd.workspaceId} — skipping capabilities publish`
    );
    await markFailed(ctx, cmd._id, 'No running harness for workspace');
    return;
  }

  await updateCapabilities(
    { publisher: deps.publisher, machineId: ctx.machineId },
    {
      harness,
      workspace: {
        workspaceId: cmd.workspaceId,
        cwd: harness.cwd,
        name: harness.cwd,
      },
    }
  );

  await ctx.deps.backend.mutation(
    api.daemon.directHarness.commands.updateCommandStatus,
    { sessionId: ctx.sessionId, commandId: cmd._id, status: 'done' }
  );

  console.log(`[direct-harness] Capabilities refreshed for workspace=${cmd.workspaceId}`);
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
