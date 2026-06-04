/**
 * Unit tests for buildAgentRequestStartEvent — the single typed constructor
 * for agent.requestStart events shared by the start-agent and
 * restart-on-new-context use cases.
 */

import { describe, expect, test } from 'vitest';

import { buildAgentRequestStartEvent } from './build-agent-request-start-event';
import { AGENT_REQUEST_DEADLINE_MS } from '../../../../config/reliability';
import type { Id } from '../../../../convex/_generated/dataModel';

const CHATROOM_ID = 'room123' as Id<'chatroom_rooms'>;

describe('buildAgentRequestStartEvent', () => {
  const base = {
    chatroomId: CHATROOM_ID,
    machineId: 'machine-1',
    role: 'builder',
    agentHarness: 'opencode' as const,
    model: 'anthropic/claude-sonnet-4',
    workingDir: '/tmp/test',
    reason: 'user.start',
  };

  test('always includes the resolved wantResume boolean', () => {
    const now = 1_000;
    const event = buildAgentRequestStartEvent(
      { ...base, wantResume: false, autoRestartOnNewContext: undefined },
      now
    );

    expect(event.type).toBe('agent.requestStart');
    expect(event.wantResume).toBe(false);
    expect(event.timestamp).toBe(now);
    expect(event.deadline).toBe(now + AGENT_REQUEST_DEADLINE_MS);
  });

  test('omits autoRestartOnNewContext key when undefined', () => {
    const event = buildAgentRequestStartEvent(
      { ...base, wantResume: true, autoRestartOnNewContext: undefined },
      0
    );
    expect('autoRestartOnNewContext' in event).toBe(false);
  });

  test('includes autoRestartOnNewContext when provided', () => {
    const event = buildAgentRequestStartEvent(
      { ...base, wantResume: true, autoRestartOnNewContext: true },
      0
    ) as { autoRestartOnNewContext?: boolean };
    expect(event.autoRestartOnNewContext).toBe(true);
  });

  test('forwards the core start fields verbatim', () => {
    const event = buildAgentRequestStartEvent(
      { ...base, wantResume: true, autoRestartOnNewContext: undefined },
      0
    );
    expect(event.chatroomId).toBe(base.chatroomId);
    expect(event.machineId).toBe(base.machineId);
    expect(event.role).toBe(base.role);
    expect(event.agentHarness).toBe(base.agentHarness);
    expect(event.model).toBe(base.model);
    expect(event.workingDir).toBe(base.workingDir);
    expect(event.reason).toBe(base.reason);
  });
});
