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
import { Effect } from 'effect';

import type { HarnessLifecycleManager } from './harness-lifecycle-manager.js';
import { api } from '../../../../api.js';
import type { CapabilitiesPublisher } from '../../../../domain/direct-harness/ports/capabilities-publisher.js';
import { updateCapabilities } from '../../../../domain/direct-harness/usecases/update-capabilities.js';
import type { BackendOps } from '../../../../infrastructure/deps/index.js';
import type { SessionId } from '../types.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Commands pending longer than this TTL are discarded as stale. */
const DIRECT_HARNESS_COMMAND_TTL_MS = 60_000;

// ─── Session ───────────────────────────────────────────────────────────────────

/** Minimal session info extracted from DaemonContext — avoids the full ctx dependency. */
export interface DirectHarnessSession {
  readonly sessionId: SessionId;
  readonly machineId: string;
  readonly backend: BackendOps;
}

// ─── Convex shape types ──────────────────────────────────────────────────────

/** Shape of a command row from listPendingCommands. */
interface PendingCommand {
  _id: string;
  _creationTime: number;
  machineId: string;
  workspaceId: string;
  type: 'refreshCapabilities' | 'refreshSessionTitle';
  refreshCapabilities?: { initiatedBy: string };
  refreshSessionTitle?: { harnessSessionId: string };
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
  /** Manages harness lifecycle: auto-start and inactivity-based shutdown. */
  readonly lifecycleManager: HarnessLifecycleManager;
  /** Publishes capability snapshots to the machine registry. */
  readonly publisher: CapabilitiesPublisher;
}

// ─── Subscriber ──────────────────────────────────────────────────────────────

export function startCommandSubscriber(
  session: DirectHarnessSession,
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
    void drain(session, deps, processed).finally(() => {
      processing = false;
      if (pendingDrain) runDrain();
    });
  };

  const unsub = wsClient.onUpdate(
    api.daemon.directHarness.commands.listPendingCommands,
    { sessionId: session.sessionId, machineId: session.machineId },
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

/** Effect twin — canonical drain loop for pending commands. */
// fallow-ignore-next-line unused-export
export const drainCommandsEffect = (
  session: DirectHarnessSession,
  deps: CommandSubscriberDeps,
  processed: Set<string>
): Effect.Effect<void, never, never> =>
  Effect.catchAll(
    Effect.gen(function* () {
      const pending = yield* Effect.tryPromise({
        try: () =>
          session.backend.query(api.daemon.directHarness.commands.listPendingCommands, {
            sessionId: session.sessionId,
            machineId: session.machineId,
          }) as Promise<PendingCommand[] | null>,
        catch: (e) => e,
      });

      if (!pending || pending.length === 0) return;

      const now = Date.now();

      for (const cmd of pending) {
        if (processed.has(cmd._id)) continue;
        processed.add(cmd._id);

        yield* Effect.catchAll(
          Effect.gen(function* () {
            if (now - cmd.createdAt > DIRECT_HARNESS_COMMAND_TTL_MS) {
              console.log(
                `[direct-harness] Discarding stale command ${cmd._id} (type=${cmd.type}, age=${now - cmd.createdAt}ms)`
              );
              yield* Effect.tryPromise({
                try: () => markFailed(session, cmd._id, 'Command expired (TTL)'),
                catch: (e) => e,
              });
              return;
            }

            switch (cmd.type) {
              case 'refreshCapabilities':
                yield* Effect.tryPromise({
                  try: () => handleRefreshCapabilities(session, deps, cmd),
                  catch: (e) => e,
                });
                break;
              case 'refreshSessionTitle':
                yield* Effect.tryPromise({
                  try: () => handleRefreshSessionTitle(session, deps, cmd),
                  catch: (e) => e,
                });
                break;
              default:
                yield* Effect.tryPromise({
                  try: () => markFailed(session, cmd._id, `Unknown command type: ${cmd.type}`),
                  catch: (e) => e,
                });
            }
          }),
          (err) =>
            Effect.gen(function* () {
              const message = err instanceof Error ? err.message : String(err);
              console.warn(`[direct-harness] Command ${cmd._id} failed: ${message}`);
              yield* Effect.tryPromise({
                try: () => markFailed(session, cmd._id, message),
                catch: () => undefined,
              }).pipe(Effect.catchAll(() => Effect.void));
            })
        );
      }
    }),
    (err) =>
      Effect.sync(() => {
        console.warn(
          `[direct-harness] Unexpected error in drainCommandsEffect:`,
          err instanceof Error ? err.message : String(err)
        );
      })
  );

/** Thin wrapper — startCommandSubscriber still calls this. */
async function drain(
  session: DirectHarnessSession,
  deps: CommandSubscriberDeps,
  processed: Set<string>
): Promise<void> {
  return Effect.runPromise(drainCommandsEffect(session, deps, processed));
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handleRefreshCapabilities(
  session: DirectHarnessSession,
  deps: CommandSubscriberDeps,
  cmd: PendingCommand
): Promise<void> {
  const payload = cmd.refreshCapabilities as RefreshCapabilitiesPayload | undefined;
  console.log(
    `[direct-harness] Processing refreshCapabilities for workspace=${cmd.workspaceId}` +
      (payload ? ` (initiatedBy=${payload.initiatedBy})` : '')
  );

  const harness = await deps.lifecycleManager.getOrStart(cmd.workspaceId);

  await updateCapabilities(
    { publisher: deps.publisher, machineId: session.machineId },
    {
      harness,
      workspace: {
        workspaceId: cmd.workspaceId,
        cwd: harness.cwd,
        name: harness.cwd,
      },
    }
  );

  await session.backend.mutation(api.daemon.directHarness.commands.updateCommandStatus, {
    sessionId: session.sessionId,
    commandId: cmd._id,
    status: 'done',
  });

  console.log(`[direct-harness] Capabilities refreshed for workspace=${cmd.workspaceId}`);
}

async function handleRefreshSessionTitle(
  session: DirectHarnessSession,
  deps: CommandSubscriberDeps,
  cmd: PendingCommand
): Promise<void> {
  const { harnessSessionId } = (cmd.refreshSessionTitle ?? {}) as { harnessSessionId?: string };
  if (!harnessSessionId) {
    await markFailed(session, cmd._id, 'refreshSessionTitle: missing harnessSessionId');
    return;
  }

  // Look up the opencodeSessionId from the backend
  const sessionRow = (await session.backend.query(api.daemon.directHarness.sessions.getSession, {
    harnessSessionId,
  })) as { opencodeSessionId?: string } | null;

  if (!sessionRow?.opencodeSessionId) {
    // Session not yet associated — nothing to fetch
    await session.backend.mutation(api.daemon.directHarness.commands.updateCommandStatus, {
      sessionId: session.sessionId,
      commandId: cmd._id,
      status: 'done',
    });
    return;
  }

  // Use the running harness to fetch the title from OpenCode
  const harness = await deps.lifecycleManager.getOrStart(cmd.workspaceId);
  const newTitle = await harness.fetchSessionTitle(sessionRow.opencodeSessionId);

  if (newTitle) {
    await session.backend.mutation(api.daemon.directHarness.sessions.updateSessionTitle, {
      sessionId: session.sessionId,
      harnessSessionId,
      sessionTitle: newTitle,
    });
    console.log(`[direct-harness] Refreshed title for session ${harnessSessionId}: "${newTitle}"`);
  }

  await session.backend.mutation(api.daemon.directHarness.commands.updateCommandStatus, {
    sessionId: session.sessionId,
    commandId: cmd._id,
    status: 'done',
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mark a command as failed with an error message. */
async function markFailed(
  session: DirectHarnessSession,
  commandId: string,
  errorMessage: string
): Promise<void> {
  await session.backend.mutation(api.daemon.directHarness.commands.updateCommandStatus, {
    sessionId: session.sessionId,
    commandId,
    status: 'failed',
    errorMessage,
  });
}
