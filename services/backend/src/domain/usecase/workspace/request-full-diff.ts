/**
 * Request Full Diff Use Case
 *
 * Enqueues a request for the full diff content of a workspace's working tree.
 * The daemon processes pending requests on its fast polling loop (~5s response).
 *
 * Phase 2: No-op stub. Phase 4+ will insert a pending row in
 * `chatroom_workspaceDiffRequests`.
 */

import type { MutationCtx } from '../../../../convex/_generated/server';
import type { DiffRequest } from '../../types/workspace-git';

/**
 * Request the full diff for a workspace.
 *
 * Idempotent: if a pending request already exists, it is not duplicated.
 * The daemon will process the request and push the result via `upsertFullDiff`.
 */
export async function requestFullDiff(
  _ctx: MutationCtx,
  _request: DiffRequest
): Promise<void> {
  // Phase 4+: insert pending row into chatroom_workspaceDiffRequests
  // and return the request ID for the frontend to poll on
}
