import { describe, expect, it } from 'vitest';

import {
  isTimelineMessageType,
  MESSAGE_TYPES,
  messageTypeValidator,
  type MessageType,
} from './message';

/**
 * Drift guard: the literal list is the source of truth, and the site `type`
 * unions plus the schema validator must stay in lockstep with it.
 *
 * Expected values are written out from the brief, not derived by re-running
 * the implementation under test.
 */
const EXPECTED_TYPES = [
  'message',
  'handoff',
  'join',
  'progress',
  'new-context',
  'notice',
  'plan',
  'grounding',
] as const;

const EXPECTED_NON_TIMELINE = ['join', 'progress'];

describe('message type vocabulary', () => {
  it('exposes the canonical literals in canonical order', () => {
    expect([...MESSAGE_TYPES]).toEqual([...EXPECTED_TYPES]);
  });

  it('derives the validator members from the same literals, in the same order', () => {
    const validatorMembers = messageTypeValidator.members.map(
      (member) => (member as { value: string }).value
    );
    expect(validatorMembers).toEqual([...EXPECTED_TYPES]);
  });

  it('hides exactly join and progress from the timeline', () => {
    const nonTimeline = EXPECTED_TYPES.filter((type) => !isTimelineMessageType(type));
    expect(nonTimeline).toEqual(EXPECTED_NON_TIMELINE);
  });

  it('treats every other canonical type as timeline content', () => {
    for (const type of EXPECTED_TYPES) {
      const expected = !(EXPECTED_NON_TIMELINE as readonly string[]).includes(type);
      expect(isTimelineMessageType(type as MessageType)).toBe(expected);
    }
  });
});
