import type { ExecuteHandoffResult } from '../../daemon/domain/errors/handoff-errors.js';
import { resolveCliHttpPort } from '../../daemon/entry/resolve-cli-http-port.js';

export type DaemonHandoffBody = {
  chatroomId: string;
  senderRole: string;
  content: string;
  targetRole: string;
  sessionId?: string;
};

export type DaemonHandoffResponse = ExecuteHandoffResult;

/**
 * POST a handoff to the daemon CLI HTTP server (P3). The daemon executes the
 * handoff locally against its read models and appends a handoff.completed
 * outbound event for projection.
 */
export async function postDaemonHandoff(body: DaemonHandoffBody): Promise<DaemonHandoffResponse> {
  const port = resolveCliHttpPort();
  const res = await fetch(`http://127.0.0.1:${port}/handoff`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as DaemonHandoffResponse;
}
