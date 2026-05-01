/**
 * Helper utilities for the direct-harness workers backend module.
 *
 * Provides:
 * - Feature flag guard (throws when directHarnessWorkers is off)
 * - Worker access guard (fetches worker + verifies chatroom membership)
 */

import { ConvexError } from 'convex/values';

import { featureFlags } from '../../../config/featureFlags.js';
import type { Doc, Id } from '../../_generated/dataModel.js';
import type { MutationCtx, QueryCtx } from '../../_generated/server.js';
import type { AuthenticatedChatroomAccess } from '../../auth/cliSessionAuth.js';
import { requireChatroomAccess } from '../../auth/cliSessionAuth.js';

// ─── Feature flag guard ──────────────────────────────────────────────────────

/**
 * Throws a ConvexError if the directHarnessWorkers feature flag is disabled.
 * Call at the top of every mutation and query in this module.
 */
export function requireDirectHarnessWorkers(): void {
  if (!featureFlags.directHarnessWorkers) {
    throw new ConvexError('directHarnessWorkers feature flag is disabled');
  }
}

// ─── Worker access guard ─────────────────────────────────────────────────────

/** The authenticated context returned when a worker access check passes. */
export interface WorkerAccess extends AuthenticatedChatroomAccess {
  worker: Doc<'chatroom_workers'>;
}

/**
 * Fetch the worker document and verify that the calling session has access to
 * the worker's chatroom. Throws on missing worker or unauthorized access.
 */
export async function getWorkerWithAccess(
  ctx: QueryCtx | MutationCtx,
  sessionId: string,
  workerId: Id<'chatroom_workers'>
): Promise<WorkerAccess> {
  const worker = await ctx.db.get(workerId);
  if (!worker) {
    throw new ConvexError({ code: 'NOT_FOUND', message: `Worker ${workerId} not found` });
  }

  const chatroomAccess = await requireChatroomAccess(ctx, sessionId, worker.chatroomId);

  return { ...chatroomAccess, worker };
}
