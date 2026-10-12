import { describe, expect, it } from 'vitest';

import { AGENT_SLOT_STATE, isAgentSlotPresent } from './agent-slot.js';

describe('isAgentSlotPresent', () => {
  it.each([
    ['idle without a pid', { state: AGENT_SLOT_STATE.IDLE }, false],
    ['spawning without a pid', { state: AGENT_SLOT_STATE.SPAWNING }, true],
    ['running with a pid', { state: AGENT_SLOT_STATE.RUNNING, pid: 100 }, true],
    ['running without a pid', { state: AGENT_SLOT_STATE.RUNNING }, false],
    ['stopping with a pid', { state: AGENT_SLOT_STATE.STOPPING, pid: 100 }, true],
    ['stopping without a pid', { state: AGENT_SLOT_STATE.STOPPING }, false],
  ] as const)('%s is present: %s', (_label, slot, expected) => {
    expect(isAgentSlotPresent(slot)).toBe(expected);
  });
});
