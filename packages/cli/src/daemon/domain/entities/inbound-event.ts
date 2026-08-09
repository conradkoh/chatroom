/**
 * Inbound events — normalized facts from Convex subscribers.
 * Subscribers map transport payloads → InboundEvent before calling event-router.
 */

export type InboundEvent =
  | { type: 'assigned-task.signal'; taskId: string; role: string }
  | { type: 'assigned-task.presence'; taskId: string; role: string }
  | { type: 'command.received'; commandId: string }
  | { type: 'direct-harness.session-opened'; harnessSessionId: string }
  | { type: 'direct-harness.prompt'; harnessSessionId: string }
  | { type: 'direct-harness.command'; commandId: string }
  | { type: 'agentic-query.session-opened'; sessionId: string }
  | { type: 'agentic-query.prompt'; sessionId: string }
  | { type: 'enhancer.job-assigned'; jobId: string }
  | { type: 'git.request'; requestId: string }
  | { type: 'file-tree.request'; requestId: string }
  | { type: 'file-content.request'; requestId: string }
  | { type: 'file-write.request'; requestId: string }
  | { type: 'workspace.list-changed'; machineId: string }
  | { type: 'command-run.updated'; runId: string }
  | {
      type: 'user-message.intent';
      chatroomId: string;
      taskId: string;
      role: string;
      revisionKey: string;
      intentType?: 'user_message' | 'queued_promotion';
      agentHarness: string;
      workingDir?: string;
      model?: string;
      createdAt: number;
    }
  | {
      type: 'orchestration.ingress';
      ingressId: string;
      revisionKey: string;
      chatroomId: string;
      content: string;
      targetRole?: string;
      attachedTaskIds?: string[];
      attachedBacklogItemIds?: string[];
      attachedMessageIds?: string[];
      attachedSnippets?: { reference: string; fileSource: string; selectedContent: string }[];
      sourcePlatform?: string;
      scheduledPromptId?: string;
      plannerEnhancerEnabled?: boolean;
    };

/** Narrowing helper — add implementations when router grows. */
export function isInboundEvent(value: unknown): value is InboundEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string'
  );
}
