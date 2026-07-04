/**
 * Directory Listing Subscription — reactive subscription for dir listing + file search.
 */
// fallow-ignore-file code-duplication

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import type { ConvexClient } from 'convex/browser';
import { Effect } from 'effect';

import { DaemonSessionService, type DaemonSessionServiceShape } from './daemon-services.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { syncDirListingToBackend } from '../../../infrastructure/services/workspace/dir-listing-sync.js';
import { searchWorkspaceFiles } from '../../../infrastructure/services/workspace/workspace-file-search.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

function logSubscriptionWarn(label: string, err: unknown): void {
  console.warn(`[${formatTimestamp()}] ⚠️  ${label}: ${getErrorMessage(err)}`);
}

export interface DirListingSubscriptionHandle {
  stop: () => void;
}

async function uploadDirListing(
  session: DaemonSessionServiceShape,
  workingDir: string,
  dirPath: string
): Promise<void> {
  await syncDirListingToBackend(session, workingDir, dirPath);

  await session.backend.mutation(api.workspaceFiles.fulfillDirListingRequest, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir,
    dirPath,
  });
}

async function uploadFileSearch(
  session: DaemonSessionServiceShape,
  workingDir: string,
  query: string
): Promise<void> {
  const result = await searchWorkspaceFiles(workingDir, query);
  const json = JSON.stringify(result);
  const dataHash = createHash('md5').update(json).digest('hex');
  const compressed = gzipSync(Buffer.from(json)).toString('base64');

  await session.backend.mutation(api.workspaceFiles.syncFileSearchV2, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir,
    query,
    data: { compression: 'gzip' as const, content: compressed },
    dataHash,
    scannedAt: result.scannedAt,
    truncated: result.truncated,
    totalCount: result.totalCount,
  });

  await session.backend.mutation(api.workspaceFiles.fulfillFileSearchRequest, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir,
    query,
  });
}

const fulfillDirListingRequestsEffect = (
  session: DaemonSessionServiceShape,
  requests: { workingDir: string; dirPath: string }[]
): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (const request of requests) {
      yield* Effect.catchAll(
        Effect.gen(function* () {
          const start = Date.now();
          yield* Effect.tryPromise(() =>
            uploadDirListing(session, request.workingDir, request.dirPath)
          );
          console.log(
            `[${formatTimestamp()}] 📂 Dir listing fulfilled: ${request.workingDir}/${request.dirPath || '(root)'} (${Date.now() - start}ms)`
          );
        }),
        (err) => {
          logSubscriptionWarn(
            `Dir listing failed for ${request.workingDir}/${request.dirPath}`,
            err
          );
          return Effect.void;
        }
      );
    }
  });

const fulfillFileSearchRequestsEffect = (
  session: DaemonSessionServiceShape,
  requests: { workingDir: string; query: string }[]
): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (const request of requests) {
      yield* Effect.catchAll(
        Effect.gen(function* () {
          const start = Date.now();
          yield* Effect.tryPromise(() =>
            uploadFileSearch(session, request.workingDir, request.query)
          );
          console.log(
            `[${formatTimestamp()}] 🔍 File search fulfilled: ${request.workingDir} query="${request.query}" (${Date.now() - start}ms)`
          );
        }),
        (err) => {
          logSubscriptionWarn(`File search failed for ${request.workingDir}`, err);
          return Effect.void;
        }
      );
    }
  });

export const startDirListingSubscriptionEffect = (
  wsClient: ConvexClient
): Effect.Effect<DirListingSubscriptionHandle, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;

    let processingDir = false;
    let processingSearch = false;

    const unsubDir = wsClient.onUpdate(
      api.workspaceFiles.getPendingDirListingRequests,
      { sessionId: session.sessionId, machineId: session.machineId },
      (requests) => {
        if (!requests?.length || processingDir) return;
        processingDir = true;
        Effect.runPromise(fulfillDirListingRequestsEffect(session, requests))
          .catch((err: unknown) => {
            logSubscriptionWarn('Dir listing subscription processing failed', err);
          })
          .finally(() => {
            processingDir = false;
          });
      },
      (err: unknown) => {
        logSubscriptionWarn('Dir listing subscription error', err);
      }
    );

    const unsubSearch = wsClient.onUpdate(
      api.workspaceFiles.getPendingFileSearchRequests,
      { sessionId: session.sessionId, machineId: session.machineId },
      (requests) => {
        if (!requests?.length || processingSearch) return;
        processingSearch = true;
        Effect.runPromise(fulfillFileSearchRequestsEffect(session, requests))
          .catch((err: unknown) => {
            logSubscriptionWarn('File search subscription processing failed', err);
          })
          .finally(() => {
            processingSearch = false;
          });
      },
      (err: unknown) => {
        logSubscriptionWarn('File search subscription error', err);
      }
    );

    console.log(`[${formatTimestamp()}] 📂 Dir listing subscription started (reactive)`);

    return {
      stop: () => {
        unsubDir();
        unsubSearch();
        console.log(`[${formatTimestamp()}] 📂 Dir listing subscription stopped`);
      },
    };
  });
