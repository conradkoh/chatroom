// fallow-ignore-file coverage-gaps
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';

import { readJsonBody, sendJson } from './http-utils.js';
import {
  claimNextTask,
  type ClaimNextTaskResult,
} from '../../../../application/use-cases/tasks/claim-next-task.js';
import type { OutboundEvent } from '../../../../domain/entities/outbound-event.js';

export type TasksRouteDeps = {
  machineId: string;
  sessionId: string;
  db: DatabaseSync;
  appendEvent: (event: OutboundEvent) => void;
};

/**
 * POST /tasks/claim-next — claim the next pending task for a role against the
 * local read models (P6). Returns the same shape as the CLI claim path.
 */
export async function handleTasksClaimNextRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: TasksRouteDeps
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, {
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' },
    });
    return;
  }

  const { chatroomId, role, taskId, messageId } = body as Record<string, unknown>;
  if (typeof chatroomId !== 'string' || typeof role !== 'string') {
    sendJson(res, 400, {
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Missing or invalid fields: chatroomId, role' },
    });
    return;
  }

  const result: ClaimNextTaskResult = claimNextTask(
    { db: deps.db, machineId: deps.machineId, appendEvent: deps.appendEvent },
    {
      chatroomId,
      role,
      taskId: typeof taskId === 'string' ? taskId : undefined,
      messageId: typeof messageId === 'string' ? messageId : undefined,
    }
  );

  if (!result.success) {
    sendJson(res, 409, result);
    return;
  }
  sendJson(res, 200, result);
}
