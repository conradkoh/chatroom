import { describe, expect, test } from 'vitest';

import {
  compareStandingInstructionHistoryByRank,
  getActiveStandingInstructions,
  normalizeStandingInstructionContent,
  standingInstructionContentKey,
} from './standing-instructions';

describe('getActiveStandingInstructions', () => {
  test('returns content when enabled and content is present', () => {
    expect(
      getActiveStandingInstructions({
        standingInstructionsEnabled: true,
        standingInstructions: '  Always use TypeScript  ',
      })
    ).toBe('Always use TypeScript');
  });

  test('returns null when disabled', () => {
    expect(
      getActiveStandingInstructions({
        standingInstructionsEnabled: false,
        standingInstructions: 'Do something',
      })
    ).toBeNull();
  });

  test('returns null when enabled is not true', () => {
    expect(
      getActiveStandingInstructions({
        standingInstructions: 'Do something',
      })
    ).toBeNull();
  });

  test('returns null when content is empty', () => {
    expect(
      getActiveStandingInstructions({
        standingInstructionsEnabled: true,
        standingInstructions: '',
      })
    ).toBeNull();
  });

  test('returns null when content is whitespace only', () => {
    expect(
      getActiveStandingInstructions({
        standingInstructionsEnabled: true,
        standingInstructions: '   ',
      })
    ).toBeNull();
  });
});

describe('normalizeStandingInstructionContent', () => {
  test('trims whitespace', () => {
    expect(normalizeStandingInstructionContent('  hello world  ')).toBe('hello world');
  });

  test('keeps empty string as empty', () => {
    expect(normalizeStandingInstructionContent('')).toBe('');
  });
});

describe('standingInstructionContentKey', () => {
  test('returns trimmed content as key', () => {
    expect(standingInstructionContentKey('  Always use TypeScript  ')).toBe(
      'Always use TypeScript'
    );
  });
});

describe('compareStandingInstructionHistoryByRank', () => {
  test('higher useCount comes first', () => {
    const a = { useCount: 1, lastUsedAt: 100 };
    const b = { useCount: 5, lastUsedAt: 200 };
    expect(compareStandingInstructionHistoryByRank(a, b)).toBeGreaterThan(0);
    expect(compareStandingInstructionHistoryByRank(b, a)).toBeLessThan(0);
  });

  test('ties broken by more recent lastUsedAt', () => {
    const a = { useCount: 3, lastUsedAt: 100 };
    const b = { useCount: 3, lastUsedAt: 500 };
    expect(compareStandingInstructionHistoryByRank(a, b)).toBeGreaterThan(0);
    expect(compareStandingInstructionHistoryByRank(b, a)).toBeLessThan(0);
  });

  test('equal useCount and lastUsedAt returns 0', () => {
    const a = { useCount: 2, lastUsedAt: 300 };
    const b = { useCount: 2, lastUsedAt: 300 };
    expect(compareStandingInstructionHistoryByRank(a, b)).toBe(0);
  });
});
