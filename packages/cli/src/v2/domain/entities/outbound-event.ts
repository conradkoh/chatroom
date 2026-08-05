/**
 * Outbound events — facts the daemon asserts via publishers.
 * Use cases emit OutboundEvent; publisher-registry routes to convex/publishers/.
 */

export type OutboundEvent =
  | { type: 'turn.chunk'; harnessSessionId: string; content: string }
  | { type: 'turn.completed'; harnessSessionId: string; turnId: string }
  | {
      type: 'session.lifecycle';
      harnessSessionId: string;
      action: 'opened' | 'resumed' | 'closed' | 'idle' | 'failed';
    }
  | { type: 'task.status'; taskId: string; role: string; status: string }
  | { type: 'git.state'; workspaceId: string }
  | { type: 'capabilities.updated'; machineId: string }
  | { type: 'models.updated'; machineId: string }
  | { type: 'command.result'; commandId: string; success: boolean }
  | { type: 'heartbeat'; machineId: string }
  | { type: 'workspace.commands'; workspaceId: string }
  | {
      type: 'harness.stream';
      harness: string;
      stream: 'stdout' | 'stderr';
      line: string;
      timestamp: number;
    };

export function isOutboundEvent(value: unknown): value is OutboundEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string'
  );
}
