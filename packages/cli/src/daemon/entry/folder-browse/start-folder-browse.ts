/**
 * Folder browse subscription — answers pending browse rows from this machine.
 *
 * The pending-row query is the non-serial transport for interactive, many-short-request work:
 * it never touches the machine command inbox or its serial tail. `stop` unsubscribes and then
 * stops the service, so no report is attempted after shutdown.
 */

import type { ConvexClient } from 'convex/browser';

import { api } from '../../../api.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import { listBrowseDirectory } from '../../../infrastructure/local-actions/list-browse-directory.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import { createFolderBrowseService } from '../../domain/usecase/folder-browse-service.js';
import { asConvexSessionId, type SessionId } from '../daemon-types.js';
import { formatTimestamp } from '../daemon-utils.js';

/** Minimal session identity needed by startFolderBrowse. */
export interface FolderBrowseSession {
  readonly sessionId: SessionId;
  readonly machineId: string;
  readonly backend: BackendOps;
}

/** Subscribes to pending folder-browse rows for this machine; returns a stop handle. */
export function startFolderBrowse(
  session: FolderBrowseSession,
  wsClient: ConvexClient
): { stop: () => void } {
  const service = createFolderBrowseService({
    listDirectory: listBrowseDirectory,
    reportListing: ({ browseId, navSeq, result }) =>
      session.backend.mutation(api.folderBrowse.reportListing, {
        sessionId: asConvexSessionId(session.sessionId),
        machineId: session.machineId,
        browseId,
        navSeq,
        result,
      }),
  });

  const unsubscribe = wsClient.onUpdate(
    api.folderBrowse.daemonPending,
    { sessionId: asConvexSessionId(session.sessionId), machineId: session.machineId },
    (rows) => {
      service.onPending(rows ?? []);
    },
    (error: unknown) => {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Folder browse subscription error: ${getErrorMessage(error)}`
      );
    }
  );

  return {
    stop: () => {
      unsubscribe();
      service.stop();
    },
  };
}
