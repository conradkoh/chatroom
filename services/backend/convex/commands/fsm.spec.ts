import { describe, expect, test } from 'vitest';
import { ConvexError } from 'convex/values';

import {
  CommandRunStatus,
  isTerminal,
  isValidTransition,
  assertValidTransition,
  TERMINAL_STATES,
} from './fsm';

const ALL_STATUSES: CommandRunStatus[] = [
  'pending',
  'running',
  'completed',
  'failed',
  'stopped',
  'killed',
];

describe('TERMINAL_STATES', () => {
  test('contains completed, failed, stopped, killed', () => {
    expect(TERMINAL_STATES.has('completed')).toBe(true);
    expect(TERMINAL_STATES.has('failed')).toBe(true);
    expect(TERMINAL_STATES.has('stopped')).toBe(true);
    expect(TERMINAL_STATES.has('killed')).toBe(true);
  });

  test('does not contain pending or running', () => {
    expect(TERMINAL_STATES.has('pending')).toBe(false);
    expect(TERMINAL_STATES.has('running')).toBe(false);
  });
});

describe('isTerminal', () => {
  test('returns true for terminal states', () => {
    for (const s of TERMINAL_STATES) {
      expect(isTerminal(s)).toBe(true);
    }
  });

  test('returns false for non-terminal states', () => {
    expect(isTerminal('pending')).toBe(false);
    expect(isTerminal('running')).toBe(false);
  });
});

describe('isValidTransition', () => {
  const expectedValid: Record<string, string[]> = {
    pending: ['running', 'failed', 'stopped', 'killed'],
    running: ['completed', 'failed', 'stopped', 'killed'],
    completed: [],
    failed: [],
    stopped: [],
    killed: [],
  };

  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      const expected = expectedValid[from]?.includes(to) ?? false;
      test(`${from} → ${to} is ${expected ? 'valid' : 'invalid'}`, () => {
        expect(isValidTransition(from, to)).toBe(expected);
      });
    }
  }
});

describe('assertValidTransition', () => {
  test('does not throw for pending → running', () => {
    expect(() => assertValidTransition('pending', 'running')).not.toThrow();
  });

  test('does not throw for pending → stopped', () => {
    expect(() => assertValidTransition('pending', 'stopped')).not.toThrow();
  });

  test('does not throw for running → completed', () => {
    expect(() => assertValidTransition('running', 'completed')).not.toThrow();
  });

  test('does not throw for running → failed', () => {
    expect(() => assertValidTransition('running', 'failed')).not.toThrow();
  });

  test('does not throw for running → killed', () => {
    expect(() => assertValidTransition('running', 'killed')).not.toThrow();
  });

  test('throws structured ConvexError for pending → pending', () => {
    try {
      assertValidTransition('pending', 'pending');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvexError);
      if (err instanceof ConvexError) {
        expect(err.data).toMatchObject({
          code: 'INVALID_RUN_STATE_TRANSITION',
          message: 'Invalid run status transition: pending → pending',
        });
      }
    }
  });

  test('throws for running → running (invalid self-transition)', () => {
    expect(() => assertValidTransition('running', 'running')).toThrow(ConvexError);
  });

  test('throws for completed → any (terminal state)', () => {
    for (const to of ALL_STATUSES) {
      if (to !== 'completed') {
        expect(() => assertValidTransition('completed', to)).toThrow(ConvexError);
      }
    }
  });

  test('throws for killed → stopped (terminal → terminal)', () => {
    expect(() => assertValidTransition('killed', 'stopped')).toThrow(ConvexError);
  });
});
