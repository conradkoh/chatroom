import { describe, expect, test } from 'vitest';

import { deriveAgentIsWorking } from './useAgentStatuses';
import { resolveAgentStatus } from '../utils/agentStatusLabel';

/** Label and square icon must share the same variant; blue only for `working`. */
function expectAligned(
  eventType: string | null,
  desiredState: string | null,
  online: boolean,
  expectedVariant: ReturnType<typeof resolveAgentStatus>['variant']
) {
  const { variant } = resolveAgentStatus(eventType, desiredState, online);
  expect(variant).toBe(expectedVariant);
  expect(deriveAgentIsWorking(eventType, desiredState, online)).toBe(
    online && expectedVariant === 'working'
  );
}

describe('deriveAgentIsWorking', () => {
  test('aligns isWorking with resolveAgentStatus variant across the label matrix', () => {
    expectAligned(null, null, true, 'offline');
    expectAligned('agent.registered', null, true, 'transitioning');
    expectAligned('agent.waiting', 'running', true, 'ready');
    expectAligned('agent.waiting', 'stopped', true, 'transitioning');
    expectAligned('agent.requestStart', null, true, 'transitioning');
    expectAligned('agent.started', null, true, 'transitioning');
    expectAligned('agent.requestStop', 'stopped', true, 'transitioning');
    expectAligned('task.acknowledged', null, true, 'transitioning');
    expectAligned('task.inProgress', null, true, 'working');
    expectAligned('task.completed', null, true, 'ready');
    expectAligned('agent.awaitingHandoff', null, true, 'transitioning');
    expectAligned('agent.exited', 'stopped', true, 'offline');
    expectAligned('agent.exited', 'running', true, 'error');
    expectAligned('agent.circuitOpen', null, true, 'error');
    expectAligned('agent.startFailed', null, true, 'error');
    expectAligned('agent.resumeStormAborted', null, true, 'error');
  });

  test('offline agent is never working even when last event was task.inProgress', () => {
    expect(deriveAgentIsWorking('task.inProgress', null, false)).toBe(false);
    expect(deriveAgentIsWorking('task.acknowledged', null, false)).toBe(false);
  });

  test('transitioning events (e.g. STARTING) are not working', () => {
    expect(deriveAgentIsWorking('agent.requestStart', null, true)).toBe(false);
    expect(deriveAgentIsWorking('agent.started', null, true)).toBe(false);
  });
});
