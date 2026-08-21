/**
 * Inbound events — normalized facts from Convex subscribers.
 * Subscribers map transport payloads → InboundEvent before calling event-router.
 */

/**
 * Command payload already delivered by the command-events subscription.
 * Keeping it on the inbound event avoids fetching the same event list again
 * before dispatching a command.
 */
export interface InboundCommandEventPayload {
  _id: string;
  type: string;
  [key: string]: unknown;
}

export type InboundEvent =
  | {
      type: 'command.received';
      commandId: string;
      commandEvent?: InboundCommandEventPayload;
    }
  | { type: 'direct-harness.session-opened'; harnessSessionId: string }
  | { type: 'direct-harness.prompt'; harnessSessionId: string }
  | { type: 'direct-harness.command'; commandId: string }
  | { type: 'agentic-query.session-opened'; sessionId: string }
  | { type: 'agentic-query.prompt'; sessionId: string }
  | { type: 'enhancer.job-assigned'; jobId: string }
  | { type: 'git.request'; requestId: string }
  | { type: 'file-tree.request'; requestId: string }
  | { type: 'file-tree.release'; requestId: string }
  | { type: 'file-content.request'; requestId: string }
  | { type: 'file-write.request'; requestId: string }
  | { type: 'workspace.list-changed'; machineId: string }
  | { type: 'command-run.updated'; runId: string };

/** Narrowing helper — add implementations when router grows. */
export function isInboundEvent(value: unknown): value is InboundEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string'
  );
}
