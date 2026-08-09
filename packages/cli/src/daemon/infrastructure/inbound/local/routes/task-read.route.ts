// fallow-ignore-file coverage-gaps
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';

import { readJsonBody, sendJson } from './http-utils.js';
import { api } from '../../../../../api.js';
import { markTaskInProgress } from '../../../../application/use-cases/tasks/read-task.js';
import type { OutboundEvent } from '../../../../domain/entities/outbound-event.js';

export type TaskReadRouteDeps = {
  machineId: string;
  sessionId: string;
  db: DatabaseSync;
  appendEvent: (event: OutboundEvent) => void;
  query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
};

/**
 * POST /tasks/read — acknowledge a task locally (acknowledged → in_progress),
 * append a task.status_changed event, and return the task prompt payload (P6).
 * Content is proxied from the Convex `getTask` read during transition.
 */
export async function handleTaskReadRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: TaskReadRouteDeps
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } });
    return;
  }

  const { chatroomId, role, taskId } = body as Record<string, unknown>;
  if (typeof chatroomId !== 'string' || typeof role !== 'string' || typeof taskId !== 'string') {
    sendJson(res, 400, {
      error: {
        code: 'BAD_REQUEST',
        message: 'Missing or invalid fields: chatroomId, role, taskId',
      },
    });
    return;
  }

  const ack = markTaskInProgress(
    { db: deps.db, machineId: deps.machineId, appendEvent: deps.appendEvent },
    { chatroomId, role, taskId }
  );
  if (!ack.success) {
    sendJson(res, 409, ack);
    return;
  }

  try {
    const task = (await deps.query(api.tasks.getTask, {
      sessionId: deps.sessionId,
      chatroomId,
      taskId,
    })) as { _id: string; content: string; status: string } | null;
    sendJson(res, 200, {
      taskId,
      status: ack.status,
      content: task?.content ?? '',
      context: null,
      attachedBacklogItems: null,
      attachedSnippets: null,
      attachedTasks: null,
      attachedMessages: null,
    });
  } catch (_err) {
    sendJson(res, 200, {
      taskId,
      status: ack.status,
      content: '',
      context: null,
      attachedBacklogItems: null,
      attachedSnippets: null,
      attachedTasks: null,
      attachedMessages: null,
    });
  }
}
