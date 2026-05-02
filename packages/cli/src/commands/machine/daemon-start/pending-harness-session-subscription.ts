/**
 * Reactive subscription for pending harness session orchestration.
 *
 * Subscribes to `listPendingSessionsForMachine` via the Convex WebSocket client.
 * When new pending sessions appear (created by the webapp's "New session" button),
 * the daemon orchestrates harness boot + session association by running the same
 * `open-session` flow used by the CLI `chatroom session open` command.
 *
 * This subscription closes the gap identified in Phase A: webapp clicks were
 * creating `chatroom_harnessSessions` rows in `pending` status that no daemon
 * subscriber ever processed — so the harness never booted and agents were never
 * published, leaving the "New session" button permanently disabled.
 *
 * Concurrency: an in-flight Set prevents duplicate processing of the same row
 * if the subscription fires again before the previous orchestration completes.
 */

import { featureFlags } from '@workspace/backend/config/featureFlags.js';
import type { ConvexClient } from 'convex/browser';

import type { DaemonContext } from './types.js';
import { api } from '../../../api.js';
import type { Id } from '../../../api.js';
import type { HarnessProcessRegistry } from '../../../application/direct-harness/get-or-spawn-harness.js';
import {
  createDefaultFlushStrategy,
  wireEventSink,
} from '../../../application/direct-harness/internal.js';
import type { HarnessSessionRowId } from '../../../domain/direct-harness/index.js';
import { openCodeChunkExtractor } from '../../../infrastructure/harnesses/opencode-sdk/chunk-extractor.js';
import {
  BufferedMessageStreamSink,
  ConvexMessageStreamTransport,
} from '../../../infrastructure/services/direct-harness/message-stream/index.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/** Handle returned by `startPendingHarnessSessionSubscription` to stop the subscription. */
export interface PendingHarnessSessionSubscriptionHandle {
  stop: () => void;
}

/**
 * Start the reactive pending-harness-session subscription.
 *
 * Only active when the `directHarnessWorkers` feature flag is enabled.
 * When pending sessions appear for this machine, opens a new harness session
 * using the existing `application/direct-harness/open-session` orchestration.
 */
export function startPendingHarnessSessionSubscription(
  ctx: DaemonContext,
  wsClient: ConvexClient,
  harnessRegistry: HarnessProcessRegistry
): PendingHarnessSessionSubscriptionHandle {
  if (!featureFlags.directHarnessWorkers) {
    return { stop: () => {} };
  }

  // Set of harnessSessionRowIds currently being processed — prevents double-spawn
  const inFlight = new Set<string>();

  const unsubscribe = wsClient.onUpdate(
    api.chatroom.directHarness.sessions.listPendingSessionsForMachine,
    {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    },
    (pendingSessions) => {
      if (!pendingSessions || pendingSessions.length === 0) return;

      for (const session of pendingSessions) {
        const rowId = session._id as string;
        if (inFlight.has(rowId)) continue;

        inFlight.add(rowId);
        void processSession(ctx, harnessRegistry, session)
          .catch((err: unknown) => {
            console.warn(
              `[direct-harness] Failed to open harness session ${rowId}: ${getErrorMessage(err)}`
            );
          })
          .finally(() => {
            inFlight.delete(rowId);
          });
      }
    },
    (err: unknown) => {
      console.warn(
        `[direct-harness] Pending harness session subscription error: ${getErrorMessage(err)}`
      );
    }
  );

  return {
    stop: () => {
      unsubscribe();
    },
  };
}

/**
 * Orchestrate opening a single pending harness session.
 *
 * Mirrors the `application/direct-harness/open-session` flow:
 *   1. Look up the workspace to get cwd
 *   2. getOrSpawn the harness process → triggers onHarnessBooted → publishes agents
 *   3. Open a session on the running harness process
 *   4. Associate the harness-issued session ID with the backend row
 *   5. Wire event sink so session output is streamed to the backend
 *
 * On failure, marks the backend session row as closed so the UI can surface the error.
 */
async function processSession(
  ctx: DaemonContext,
  harnessRegistry: HarnessProcessRegistry,
  session: {
    _id: Id<'chatroom_harnessSessions'>;
    workspaceId: Id<'chatroom_workspaces'>;
    lastUsedConfig: { agent: string };
    harnessName: string;
  }
): Promise<void> {
  const rowId = session._id as string;

  // 1. Look up workspace to get workingDir for harness process spawning
  const workspace = await ctx.deps.backend.query(api.workspaces.getWorkspaceById, {
    sessionId: ctx.sessionId,
    workspaceId: session.workspaceId,
  });

  if (!workspace) {
    console.warn(
      `[direct-harness] Cannot open harness session ${rowId}: workspace ${session.workspaceId} not found`
    );
    await ctx.deps.backend
      .mutation(api.chatroom.directHarness.sessions.closeSession, {
        sessionId: ctx.sessionId,
        harnessSessionRowId: session._id,
      })
      .catch(() => {}); // best-effort
    return;
  }

  // 2. Get or spawn the harness process
  //    This also triggers onHarnessBooted → publishes agents → button enables
  const harnessProcess = await harnessRegistry.getOrSpawn(
    session.workspaceId as string,
    workspace.workingDir
  );

  // 3. Open a session on the running harness process
  const harnessSession = await harnessProcess.spawner.openSession({
    config: { agent: session.lastUsedConfig.agent },
  });

  // 4. Associate the harness-issued session ID with the backend row.
  //    If this fails, close the harness session to avoid leaking processes.
  try {
    await ctx.deps.backend.mutation(api.chatroom.directHarness.sessions.associateHarnessSessionId, {
      sessionId: ctx.sessionId,
      harnessSessionRowId: session._id,
      harnessSessionId: harnessSession.harnessSessionId as string,
    });
  } catch (err) {
    await harnessSession.close().catch(() => {});
    throw err;
  }

  // 5. Wire session events through the chunk extractor into the message sink.
  //    The session runs detached under the daemon's process lifetime — no handle returned.
  const transport = new ConvexMessageStreamTransport({
    backend: ctx.deps.backend,
    sessionId: ctx.sessionId,
  });
  const sink = new BufferedMessageStreamSink({
    workerId: session._id as unknown as HarnessSessionRowId,
    transport,
    strategy: createDefaultFlushStrategy(),
  });

  wireEventSink(harnessSession, sink, openCodeChunkExtractor);

  console.log(
    `[direct-harness] Harness session opened: rowId=${rowId} agent=${session.lastUsedConfig.agent} workspace=${session.workspaceId}`
  );
}
