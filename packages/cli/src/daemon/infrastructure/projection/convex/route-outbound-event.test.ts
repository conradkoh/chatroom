import { describe, expect, it, vi } from 'vitest';

import {
  assertProjectableEvent,
  createConvexPublishers,
  routeConvexEvent,
} from './route-outbound-event.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';

function makePublishers() {
  return createConvexPublishers({
    backend: { mutation: vi.fn().mockResolvedValue(undefined), query: vi.fn() },
    sessionId: 'sess-1',
    machineId: 'machine-1',
  });
}

const handledEvents: OutboundEvent[] = [
  { type: 'heartbeat', machineId: 'machine-1' },
  { type: 'turn.chunk', harnessSessionId: 'hs-1', content: 'chunk', timestamp: 1 },
  { type: 'turn.completed', harnessSessionId: 'hs-1', turnId: 'turn-1' },
  { type: 'session.lifecycle', harnessSessionId: 'hs-1', action: 'opened' },
  {
    type: 'task.status',
    variant: 'delivery',
    taskId: 'task-1',
    role: 'builder',
    chatroomId: 'room-1',
    outcome: 'delivered',
  },
  { type: 'git.state', workingDir: '/workspace', payload: {} },
  {
    type: 'capabilities.updated',
    capabilities: { machineId: 'machine-1', lastSeenAt: 1, workspaces: [] },
  },
  {
    type: 'models.updated',
    availableModels: {},
    availableHarnesses: [],
    harnessVersions: {},
  },
  {
    type: 'harness.fingerprint.updated',
    fingerprint: 'f1',
    availableHarnesses: [],
    harnessVersions: {},
  },
  { type: 'command.result.ping', pingEventId: 'ping-1' },
  { type: 'command.result.folder-picker', requestId: 'req-1', status: 'completed' },
  { type: 'command.result.capabilities-refresh', batchId: 'batch-1', status: 'completed' },
  { type: 'workspace.commands', workingDir: '/workspace', commands: [] },
  {
    type: 'handoff.completed',
    idempotencyKey: 'room-1:msg-1',
    sessionId: 'sess-1',
    chatroomId: 'room-1',
    senderRole: 'planner',
    content: 'handoff message',
    targetRole: 'builder',
    messageId: 'msg-1',
    completedTaskIds: ['task-1'],
    timestamp: 100,
  },
  {
    type: 'agent.start_failed',
    idempotencyKey: 'room-1:builder:start_failed',
    chatroomId: 'room-1',
    role: 'builder',
    machineId: 'machine-1',
    error: 'spawn failed',
    timestamp: 100,
  },
  {
    type: 'agent.stop_timeout',
    idempotencyKey: 'room-1:builder:stop_timeout',
    chatroomId: 'room-1',
    role: 'builder',
    machineId: 'machine-1',
    durationMs: 30_000,
    timestamp: 100,
  },
  {
    type: 'session.resume_requested',
    idempotencyKey: 'room-1:builder:resume_requested',
    chatroomId: 'room-1',
    role: 'builder',
    machineId: 'machine-1',
    agentHarness: 'opencode',
    timestamp: 100,
  },
  {
    type: 'session.resumed',
    idempotencyKey: 'room-1:builder:resumed',
    chatroomId: 'room-1',
    role: 'builder',
    machineId: 'machine-1',
    timestamp: 100,
  },
  {
    type: 'session.resume_failed',
    idempotencyKey: 'room-1:builder:resume_failed',
    chatroomId: 'room-1',
    role: 'builder',
    machineId: 'machine-1',
    reason: 'network',
    timestamp: 100,
  },
  {
    type: 'session.reopen_retry',
    idempotencyKey: 'room-1:builder:reopen_retry_1',
    chatroomId: 'room-1',
    role: 'builder',
    machineId: 'machine-1',
    attempt: 1,
    maxAttempts: 3,
    timestamp: 100,
  },
  {
    type: 'harness.session_id_updated',
    idempotencyKey: 'room-1:builder:session_id_updated',
    chatroomId: 'room-1',
    role: 'builder',
    machineId: 'machine-1',
    correlationId: 'corr-1',
    resumableId: 'res-1',
    source: 'provider_allocated',
    timestamp: 100,
  },
  {
    type: 'restart.limit_reached',
    idempotencyKey: 'room-1:builder:restart_limit_reached',
    chatroomId: 'room-1',
    role: 'builder',
    machineId: 'machine-1',
    restartCount: 5,
    windowMs: 60_000,
    timestamp: 100,
  },
  {
    type: 'agent.native_end',
    idempotencyKey: 'room-1:builder:native_end_100',
    chatroomId: 'room-1',
    role: 'builder',
    machineId: 'machine-1',
    timestamp: 100,
  },
  {
    type: 'restart.phase',
    idempotencyKey: 'room-1:builder:restart_phase_corr-1',
    chatroomId: 'room-1',
    role: 'builder',
    machineId: 'machine-1',
    correlationId: 'corr-1',
    phase: 'spawn',
    timestamp: 100,
  },
  {
    type: 'restart.completed',
    idempotencyKey: 'room-1:builder:restart_completed_corr-1',
    chatroomId: 'room-1',
    role: 'builder',
    machineId: 'machine-1',
    correlationId: 'corr-1',
    timestamp: 100,
  },
];

describe('routeConvexEvent', () => {
  it('routes every handled OutboundEvent type to a handler', () => {
    const publishers = makePublishers();
    for (const event of handledEvents) {
      const result = routeConvexEvent(publishers, event);
      expect(result, `expected a handler for ${event.type}`).toBeDefined();
    }
  });

  it('returns undefined for harness.stream (T0 — not projectable)', () => {
    const publishers = makePublishers();
    const result = routeConvexEvent(publishers, {
      type: 'harness.stream',
      harness: 'h1',
      stream: 'stdout',
      line: 'hello',
      timestamp: 1,
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined for turn.ended (T0 — local-only, not projectable)', () => {
    const publishers = makePublishers();
    const result = routeConvexEvent(publishers, {
      type: 'turn.ended',
      idempotencyKey: 'room-1:builder:turn_ended_1',
      chatroomId: 'room-1',
      role: 'builder',
      machineId: 'machine-1',
      timestamp: 1,
    });
    expect(result).toBeUndefined();
  });
});

describe('assertProjectableEvent', () => {
  it('passes for handled event types', () => {
    const publishers = makePublishers();
    expect(() =>
      assertProjectableEvent(publishers, { type: 'heartbeat', machineId: 'm-1' })
    ).not.toThrow();
  });

  it('throws for unhandled event types', () => {
    const publishers = makePublishers();
    expect(() =>
      assertProjectableEvent(publishers, {
        type: 'harness.stream',
        harness: 'h1',
        stream: 'stdout',
        line: 'hello',
        timestamp: 1,
      })
    ).toThrow('No projection handler for event type: harness.stream');
  });
});
