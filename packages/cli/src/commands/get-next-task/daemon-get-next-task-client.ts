import type { ClaimNextTaskResult } from '../../daemon/application/use-cases/tasks/claim-next-task.js';
import { postDaemonJson } from '../daemon-http-client.js';

export type DaemonClaimNextTaskBody = {
  chatroomId: string;
  role: string;
  sessionId?: string;
  taskId?: string;
  messageId?: string;
};

/**
 * POST a task claim to the daemon CLI HTTP server (P6). The daemon claims the
 * task against its local read models and appends a `task.claimed` outbound
 * event for idempotent projection to Convex.
 */
export async function postDaemonClaimNextTask(
  body: DaemonClaimNextTaskBody
): Promise<ClaimNextTaskResult> {
  return (await postDaemonJson('/tasks/claim-next', body)) as ClaimNextTaskResult;
}
