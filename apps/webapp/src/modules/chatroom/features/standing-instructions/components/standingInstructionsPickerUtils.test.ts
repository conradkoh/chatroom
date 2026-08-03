import { describe, expect, it } from 'vitest';

import {
  buildStandingInstructionsPickerList,
  findActiveHistoryMatch,
  SYNTHETIC_CURRENT_ID,
} from './standingInstructionsPickerUtils';
import type { StandingInstructionHistoryItem } from '../types/standingInstructionHistory';

function historyItem(
  id: string,
  content: string,
  title: string,
  useCount = 1,
  lastUsedAt = 0
): StandingInstructionHistoryItem {
  return { id, content, title, useCount, lastUsedAt };
}

describe('findActiveHistoryMatch', () => {
  it('matches by content key, ignoring whitespace', () => {
    const history = [historyItem('a', '  Always use TS  ', 'Rules')];
    expect(findActiveHistoryMatch(history, 'Always use TS')).toBe('a');
  });

  it('returns null when no content match', () => {
    const history = [historyItem('a', 'Rule A', 'A')];
    expect(findActiveHistoryMatch(history, 'Rule B')).toBeNull();
  });
});

describe('buildStandingInstructionsPickerList', () => {
  const history: StandingInstructionHistoryItem[] = [
    historyItem('h1', 'Content one', 'Title one', 10, 100),
    historyItem('h2', 'Content two', 'Title two', 8, 200),
    historyItem('h3', 'Content three', 'Title three', 5, 300),
    historyItem('h4', 'Content four', 'Title four', 3, 400),
  ];

  it('inactive: returns first N from history order with activeId null and hasMore', () => {
    const extendedHistory = [
      ...history,
      historyItem('h5', 'c5', 't5'),
      historyItem('h6', 'c6', 't6'),
      historyItem('h7', 'c7', 't7'),
      historyItem('h8', 'c8', 't8'),
      historyItem('h9', 'c9', 't9'),
      historyItem('h10', 'c10', 't10'),
    ];
    const result = buildStandingInstructionsPickerList({
      history: extendedHistory,
      storedContent: 'Content one',
      storedTitle: 'Title one',
      isActive: false,
    });

    expect(result.activeId).toBeNull();
    expect(result.visible).toHaveLength(8);
    expect(result.visible.map((i) => i.id)).toEqual([
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'h7',
      'h8',
    ]);
    expect(result.hasMore).toBe(true);
  });

  it('active with history match: active row first, alternates follow, activeId is matched id', () => {
    const result = buildStandingInstructionsPickerList({
      history,
      storedContent: 'Content two',
      storedTitle: 'Renamed title',
      isActive: true,
    });

    expect(result.activeId).toBe('h2');
    expect(result.visible).toHaveLength(3);
    expect(result.visible[0].id).toBe('h2');
    expect(result.visible[1].id).toBe('h1');
    expect(result.visible[2].id).toBe('h3');
    expect(result.hasMore).toBe(true);
  });

  it('active with no history match: synthetic row first with activeId __current__', () => {
    const result = buildStandingInstructionsPickerList({
      history,
      storedContent: 'Unique active content',
      storedTitle: 'Active title',
      isActive: true,
    });

    expect(result.activeId).toBe(SYNTHETIC_CURRENT_ID);
    expect(result.visible).toHaveLength(3);
    expect(result.visible[0]).toEqual({
      id: SYNTHETIC_CURRENT_ID,
      content: 'Unique active content',
      title: 'Active title',
    });
    expect(result.visible[1].id).toBe('h1');
    expect(result.visible[2].id).toBe('h2');
  });

  it('active with empty history: only synthetic row and hasMore false', () => {
    const result = buildStandingInstructionsPickerList({
      history: [],
      storedContent: 'Active only',
      storedTitle: 'Only title',
      isActive: true,
    });

    expect(result.activeId).toBe(SYNTHETIC_CURRENT_ID);
    expect(result.visible).toHaveLength(1);
    expect(result.visible[0]).toEqual({
      id: SYNTHETIC_CURRENT_ID,
      content: 'Active only',
      title: 'Only title',
    });
    expect(result.hasMore).toBe(false);
  });

  it('title rename: content match uses history id even when stored title differs', () => {
    const result = buildStandingInstructionsPickerList({
      history,
      storedContent: 'Content three',
      storedTitle: 'New display title',
      isActive: true,
    });

    expect(result.activeId).toBe('h3');
    expect(result.visible[0].id).toBe('h3');
    expect(result.visible[0].id).not.toBe(SYNTHETIC_CURRENT_ID);
  });

  it('inactive with empty content when isActive: treats as inactive list', () => {
    const result = buildStandingInstructionsPickerList({
      history,
      storedContent: '   ',
      storedTitle: '',
      isActive: true,
    });

    expect(result.activeId).toBeNull();
    expect(result.visible).toHaveLength(4);
    expect(result.hasMore).toBe(false);
  });
});
