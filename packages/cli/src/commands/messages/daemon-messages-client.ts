import { getDaemonJson } from '../daemon-http-client.js';

/** Shared shape for messages returned from the backend (mirrors commands/messages). */
export type DaemonMessageItem = {
  _id: string;
  _creationTime: number;
  type: string;
  content: string;
  senderRole: string;
  targetRole: string | null;
  taskStatus: string | null;
};

export type DaemonListMessagesParams = {
  chatroomId: string;
  role: string;
  senderRole?: string;
  sinceMessageId?: string;
  limit?: number;
};

function queryString(params: DaemonListMessagesParams): string {
  const url = new URL('http://127.0.0.1/');
  url.searchParams.set('chatroomId', params.chatroomId);
  url.searchParams.set('role', params.role);
  url.searchParams.set('limit', String(params.limit ?? 100));
  if (params.senderRole) url.searchParams.set('senderRole', params.senderRole);
  if (params.sinceMessageId) url.searchParams.set('sinceMessageId', params.sinceMessageId);
  return url.search;
}

/**
 * GET messages since a message id from the daemon CLI HTTP server (P6).
 */
export async function getDaemonMessagesSince(
  params: DaemonListMessagesParams
): Promise<DaemonMessageItem[]> {
  return (await getDaemonJson(
    `/messages/list-since${queryString({ ...params, limit: params.limit ?? 100 })}`
  )) as DaemonMessageItem[];
}

/**
 * GET messages from a sender role from the daemon CLI HTTP server (P6).
 */
export async function getDaemonMessagesBySender(
  params: DaemonListMessagesParams
): Promise<DaemonMessageItem[]> {
  return (await getDaemonJson(
    `/messages/list-by-sender${queryString({ ...params, limit: params.limit ?? 10 })}`
  )) as DaemonMessageItem[];
}
