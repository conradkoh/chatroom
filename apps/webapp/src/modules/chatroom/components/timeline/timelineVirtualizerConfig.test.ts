import { describe, it, expect } from 'vitest';

import type { TimelineEvent } from '../../timeline/types';

import {
  TIMELINE_ESTIMATE_SIZE,
  TIMELINE_ROW_BASE_CONTEXT,
  TIMELINE_ROW_BASE_TEAM,
  TIMELINE_ROW_BASE_USER,
  TIMELINE_ROW_CHARS_PER_LINE,
  TIMELINE_ROW_CODE_BLOCK_BIAS,
  TIMELINE_ROW_LINE_HEIGHT,
  TIMELINE_ROW_MAX_ESTIMATE,
  TIMELINE_ROW_MIN_ESTIMATE,
  estimateTimelineRowSize,
  getTimelineItemKey,
} from './timelineVirtualizerConfig';

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

function userMessage(content: string): TimelineEvent {
  return {
    id: 'u',
    kind: 'user_message',
    creationTime: 1,
    message: {
      _id: 'u',
      type: 'message',
      senderRole: 'user',
      content,
      _creationTime: 1,
    },
  };
}

function teamMessage(content: string): TimelineEvent {
  return {
    id: 't',
    kind: 'team_message',
    creationTime: 2,
    message: {
      _id: 't',
      type: 'message',
      senderRole: 'builder',
      content,
      _creationTime: 2,
    },
  };
}

function contextEvent(): TimelineEvent {
  return {
    id: 'c',
    kind: 'context',
    creationTime: 0,
    message: {
      _id: 'c',
      type: 'message',
      senderRole: 'user',
      content: '',
      _creationTime: 0,
    },
  };
}

describe('estimateTimelineRowSize', () => {
  it('returns base height for context rows', () => {
    expect(estimateTimelineRowSize(contextEvent())).toBe(TIMELINE_ROW_BASE_CONTEXT);
  });

  it('returns base + one line for empty user_message', () => {
    expect(estimateTimelineRowSize(userMessage(''))).toBe(
      TIMELINE_ROW_BASE_USER + TIMELINE_ROW_LINE_HEIGHT,
    );
  });

  it('returns base + one line for short team_message', () => {
    expect(estimateTimelineRowSize(teamMessage('hello'))).toBe(
      TIMELINE_ROW_BASE_TEAM + TIMELINE_ROW_LINE_HEIGHT,
    );
  });

  it('scales with wrapped line count for long messages', () => {
    const longText = 'x'.repeat(200);
    const expectedMin =
      TIMELINE_ROW_BASE_USER + Math.ceil(200 / TIMELINE_ROW_CHARS_PER_LINE) * TIMELINE_ROW_LINE_HEIGHT;
    expect(estimateTimelineRowSize(userMessage(longText))).toBeGreaterThanOrEqual(expectedMin);
  });

  it('adds one code-block bias for two fence markers', () => {
    const plain = userMessage('plaintext');
    const withOneBlock = userMessage('```code```');
    expect(estimateTimelineRowSize(withOneBlock) - estimateTimelineRowSize(plain)).toBe(
      TIMELINE_ROW_CODE_BLOCK_BIAS,
    );
  });

  it('adds two code-block biases for four fence markers', () => {
    const oneBlock = userMessage('```a```');
    const twoBlocks = userMessage('```a``` ```b```');
    expect(estimateTimelineRowSize(twoBlocks) - estimateTimelineRowSize(oneBlock)).toBe(
      TIMELINE_ROW_CODE_BLOCK_BIAS,
    );
  });

  it('falls back to TIMELINE_ESTIMATE_SIZE for undefined event', () => {
    expect(estimateTimelineRowSize(undefined)).toBe(TIMELINE_ESTIMATE_SIZE);
  });

  it('clamps output between min and max for extreme content lengths', () => {
    for (const len of [0, 1, 100, 10_000, 100_000]) {
      const size = estimateTimelineRowSize(userMessage('a'.repeat(len)));
      expect(size).toBeGreaterThanOrEqual(TIMELINE_ROW_MIN_ESTIMATE);
      expect(size).toBeLessThanOrEqual(TIMELINE_ROW_MAX_ESTIMATE);
    }
  });
});

describe('getTimelineItemKey', () => {
  it('uses event id for stable virtualizer keys', () => {
    expect(getTimelineItemKey(0, sampleEvents)).toBe('a');
    expect(getTimelineItemKey(1, sampleEvents)).toBe('b');
  });

  it('falls back to index when event missing', () => {
    expect(getTimelineItemKey(99, sampleEvents)).toBe('99');
  });
});
