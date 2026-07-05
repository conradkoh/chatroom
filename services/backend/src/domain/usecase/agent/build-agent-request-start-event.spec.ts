/**
 * Unit tests for buildAgentRequestStartEvent — the single typed constructor
 * for agent.requestStart events.
 */

import { describe, expect, test } from 'vitest';

import { buildAgentRequestStartEvent } from './build-agent-request-start-event';
import { AGENT_REQUEST_DEADLINE_MS } from '../../../../config/reliability';
import type { Id } from '../../../../convex/_generated/dataModel';
import { TEST_MODEL_OPENCODE } from '../../../../tests/helpers/test-models';

const CHATROOM_ID = 'room123' as Id<'chatroom_rooms'>;

describe('buildAgentRequestStartEvent', () => {
  const base = {
    chatroomId: CHATROOM_ID,
    machineId: 'machine-1',
    role: 'builder',
    agentHarness: 'opencode' as const,
    model: TEST_MODEL_OPENCODE,
    workingDir: '/tmp/test',
    reason: 'user.start',
  };

  test('always includes the resolved wantResume boolean', () => {
    const now = 1_000;
    const event = buildAgentRequestStartEvent({ ...base, wantResume: false }, now);

    expect(event.type).toBe('agent.requestStart');
    expect(event.wantResume).toBe(false);
    expect(event.timestamp).toBe(now);
    expect(event.deadline).toBe(now + AGENT_REQUEST_DEADLINE_MS);
  });

  test('forwards the core start fields verbatim', () => {
    const event = buildAgentRequestStartEvent({ ...base, wantResume: true }, 0);
    expect(event.chatroomId).toBe(base.chatroomId);
    expect(event.machineId).toBe(base.machineId);
    expect(event.role).toBe(base.role);
    expect(event.agentHarness).toBe(base.agentHarness);
    expect(event.model).toBe(base.model);
    expect(event.workingDir).toBe(base.workingDir);
    expect(event.reason).toBe(base.reason);
  });
});
