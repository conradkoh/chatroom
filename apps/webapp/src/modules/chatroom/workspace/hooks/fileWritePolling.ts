// fallow-ignore-file complexity
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { ConvexReactClient } from 'convex/react';

const FILE_WRITE_POLL_INTERVAL_MS = 500;
const FILE_WRITE_POLL_TIMEOUT_MS = 30_000;

export type FileWriteRequestStatus = {
  status: 'pending' | 'done' | 'error';
  errorMessage?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll a write request until it completes or times out. */
// fallow-ignore-next-line complexity
// fallow-ignore-next-line unused-export
export async function pollFileWriteRequest(
  queryFn: (
    requestId: Id<'chatroom_workspaceFileWriteRequests'>
  ) => Promise<FileWriteRequestStatus | null>,
  requestId: Id<'chatroom_workspaceFileWriteRequests'>
): Promise<void> {
  const deadline = Date.now() + FILE_WRITE_POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const result = await queryFn(requestId);
    if (result?.status === 'done') return;
    if (result?.status === 'error') {
      throw new Error(result.errorMessage ?? 'File write failed');
    }
    await sleep(FILE_WRITE_POLL_INTERVAL_MS);
  }

  throw new Error('File write timed out');
}

/** Poll a write request via Convex until it completes or times out. */
export async function waitForFileWriteRequest(
  convex: ConvexReactClient,
  sessionId: string | null,
  requestId: Id<'chatroom_workspaceFileWriteRequests'>
): Promise<void> {
  await pollFileWriteRequest(async (id) => {
    if (!sessionId) {
      throw new Error('Authentication required');
    }
    return convex.query(api.workspaceFiles.getFileWriteRequest, {
      sessionId,
      requestId: id,
    });
  }, requestId);
}
