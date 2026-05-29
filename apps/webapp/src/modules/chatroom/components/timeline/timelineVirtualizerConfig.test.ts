import { describe, it, expect } from 'vitest';

import type { TimelineEvent } from '../../timeline/types';

import { getTimelineItemKey } from './timelineVirtualizerConfig';

const sampleEvents: TimelineEvent[] = [
  {
    id: 'a',
    kind: 'user_message',
    creationTime: 1,
    message: {
      _id: 'a',
      type: 'message',
      senderRole: 'user',
      content: 'one',
      _creationTime: 1,
    },
  },
  {
    id: 'b',
    kind: 'team_message',
    creationTime: 2,
    message: {
      _id: 'b',
      type: 'message',
      senderRole: 'builder',
      content: 'two',
      _creationTime: 2,
    },
  },
];

describe('getTimelineItemKey', () => {
  it('uses event id for stable virtualizer keys', () => {
    expect(getTimelineItemKey(0, sampleEvents)).toBe('a');
    expect(getTimelineItemKey(1, sampleEvents)).toBe('b');
  });

  it('falls back to index when event missing', () => {
    expect(getTimelineItemKey(99, sampleEvents)).toBe('99');
  });
});
