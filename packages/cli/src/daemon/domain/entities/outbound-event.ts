/**
 * Outbound events — facts the daemon asserts via publishers.
 * Use cases emit OutboundEvent; publisher-registry routes to convex/publishers/.
 */

import type { MachineCapabilities } from './machine-capabilities.js';

export type OutboundEvent =
  | {
      type: 'turn.chunk';
      harnessSessionId: string;
      content: string;
      timestamp: number;
      messageId?: string | undefined;
      partType?: string | undefined;
    }
  | { type: 'turn.completed'; harnessSessionId: string; turnId: string }
  | {
      type: 'session.lifecycle';
      harnessSessionId: string;
      action: 'opened' | 'resumed' | 'closed' | 'idle' | 'failed';
      opencodeSessionId?: string | undefined;
      sessionTitle?: string | undefined;
    }
  | {
      type: 'task.status';
      taskId: string;
      role: string;
      chatroomId: string;
      outcome: 'delivered' | 'delivery_failed';
      error?: string | undefined;
    }
  | {
      type: 'git.state';
      workingDir: string;
      payload: Record<string, unknown>;
    }
  | { type: 'capabilities.updated'; capabilities: MachineCapabilities }
  | {
      type: 'models.updated';
      availableModels: Record<string, string[]>;
      availableHarnesses: readonly string[];
      harnessVersions: Record<string, unknown>;
    }
  | {
      type: 'harness.fingerprint.updated';
      fingerprint: string;
      availableHarnesses: readonly string[];
      harnessVersions: Record<string, unknown>;
    }
  | { type: 'command.result.ping'; pingEventId: string }
  | {
      type: 'command.result.folder-picker';
      requestId: string;
      status: 'completed' | 'cancelled' | 'failed';
      selectedPath?: string | undefined;
      errorMessage?: string | undefined;
    }
  | {
      type: 'command.result.capabilities-refresh';
      batchId: string;
      status: 'completed' | 'skipped_no_changes' | 'failed';
      errorMessage?: string | undefined;
    }
  | { type: 'heartbeat'; machineId: string }
  | { type: 'workspace.commands'; workingDir: string; commands: unknown[] }
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
