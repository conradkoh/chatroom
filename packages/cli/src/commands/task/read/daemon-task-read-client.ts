import { postDaemonJson } from '../../daemon-http-client.js';

export type DaemonTaskReadResult = {
  taskId: string;
  status: string;
  content: string;
  context?: string | null;
  attachedBacklogItems?: unknown[] | null;
  attachedSnippets?: unknown[] | null;
  attachedTasks?: unknown[] | null;
  attachedMessages?: unknown[] | null;
};

/**
 * POST a task read to the daemon CLI HTTP server (P6). The daemon acknowledges
 * the task locally and returns the task prompt payload.
 */
export async function postDaemonTaskRead(params: {
  chatroomId: string;
  role: string;
  taskId: string;
  sessionId?: string;
}): Promise<DaemonTaskReadResult> {
  const result = (await postDaemonJson('/tasks/read', params)) as
    DaemonTaskReadResult | { error?: { message?: string } };
  if ('error' in result && result.error) {
    throw new Error(result.error.message);
  }
  return result as DaemonTaskReadResult;
}
