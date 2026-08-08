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
