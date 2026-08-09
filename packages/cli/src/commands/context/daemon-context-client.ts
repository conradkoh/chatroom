import { getDaemonJson } from '../daemon-http-client.js';

/** Context payload shape (mirrors commands/context readContext). */
export type DaemonContextPayload = {
  messages: {
    _id: string;
    senderRole: string;
    targetRole?: string;
    type: string;
    content: string;
    taskId?: string;
    taskStatus?: string;
    taskContent?: string;
    attachedTasks?: { _id: string; content: string }[];
  }[];
  currentContext?: {
    content: string;
    createdBy: string;
    createdAt: number;
  };
  originMessage?: {
    _id: string;
    _creationTime: number;
  };
  pendingTasksForRole: number;
};

/**
 * GET conversation context for a role from the daemon CLI HTTP server (P6).
 */
export async function getDaemonContext(params: {
  chatroomId: string;
  role: string;
}): Promise<DaemonContextPayload> {
  const url = new URL('http://127.0.0.1/context/read');
  url.searchParams.set('chatroomId', params.chatroomId);
  url.searchParams.set('role', params.role);
  return (await getDaemonJson(url.pathname + url.search)) as DaemonContextPayload;
}
