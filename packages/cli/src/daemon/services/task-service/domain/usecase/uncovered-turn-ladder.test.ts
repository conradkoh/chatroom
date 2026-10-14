import { describe, expect, test } from 'vitest';

import {
  MAX_SESSION_RESTARTS_PER_TASK,
  decideUncoveredTurnEnd,
  withNudgeSent,
  withSessionRestart,
  type UncoveredTurnLadderEntry,
} from './uncovered-turn-ladder.js';

describe('MAX_SESSION_RESTARTS_PER_TASK', () => {
  test('is 1, so a change to the ladder budget is a visible decision', () => {
    expect(MAX_SESSION_RESTARTS_PER_TASK).toBe(1);
  });
});

describe('decideUncoveredTurnEnd', () => {
  test.each<{
    name: string;
    entry: UncoveredTurnLadderEntry | undefined;
    sessionKey: string;
    opts?: { nudgeUnavailable?: boolean };
    expected: 'nudge' | 'restart-session' | 'park';
  }>([
    {
      name: 'no entry, session A -> nudge',
      entry: undefined,
      sessionKey: 'A',
      expected: 'nudge',
    },
    {
      name: 'nudged in A, restarts 0, session A -> restart-session',
      entry: { nudgedSessionKey: 'A', sessionRestarts: 0 },
      sessionKey: 'A',
      expected: 'restart-session',
    },
    {
      name: 'nudged in A, restarts 1, session A -> park',
      entry: { nudgedSessionKey: 'A', sessionRestarts: 1 },
      sessionKey: 'A',
      expected: 'park',
    },
    {
      name: 'nudged in A, restarts 0, new session B -> nudge (re-armed)',
      entry: { nudgedSessionKey: 'A', sessionRestarts: 0 },
      sessionKey: 'B',
      expected: 'nudge',
    },
    {
      name: 'no nudge key, restarts 1, new session B -> nudge (fresh session gets one nudge)',
      entry: { nudgedSessionKey: undefined, sessionRestarts: 1 },
      sessionKey: 'B',
      expected: 'nudge',
    },
    {
      name: 'nudge unavailable, no entry -> restart-session, never nudge',
      entry: undefined,
      sessionKey: 'A',
      opts: { nudgeUnavailable: true },
      expected: 'restart-session',
    },
    {
      name: 'nudge unavailable, restarts 1 -> park',
      entry: { sessionRestarts: 1 },
      sessionKey: 'A',
      opts: { nudgeUnavailable: true },
      expected: 'park',
    },
  ])('$name', ({ entry, sessionKey, opts, expected }) => {
    expect(decideUncoveredTurnEnd(entry, sessionKey, opts).action).toBe(expected);
  });

  test('full sequence applies at most two nudges and one restart, in order', () => {
    const decisions: string[] = [];
    let entry: UncoveredTurnLadderEntry | undefined;
    let nudges = 0;
    let restarts = 0;

    const step = (sessionKey: string): string => {
      const decision = decideUncoveredTurnEnd(entry, sessionKey);
      if (decision.action === 'nudge') {
        nudges += 1;
        entry = withNudgeSent(entry, sessionKey);
      } else if (decision.action === 'restart-session') {
        restarts += 1;
        entry = withSessionRestart(entry);
      }
      decisions.push(`${sessionKey}:${decision.action}`);
      return decision.action;
    };

    expect(step('A')).toBe('nudge');
    expect(step('A')).toBe('restart-session');
    expect(step('B')).toBe('nudge');
    expect(step('B')).toBe('park');

    expect(decisions).toEqual(['A:nudge', 'A:restart-session', 'B:nudge', 'B:park']);
    expect(nudges).toBe(2);
    expect(restarts).toBe(1);
  });
});

describe('withNudgeSent', () => {
  test('from no entry records the nudge with zero restarts', () => {
    expect(withNudgeSent(undefined, 'A')).toEqual({ nudgedSessionKey: 'A', sessionRestarts: 0 });
  });

  test('keeps the restart count when moving the nudge to a new session', () => {
    expect(withNudgeSent({ nudgedSessionKey: 'A', sessionRestarts: 1 }, 'B')).toEqual({
      nudgedSessionKey: 'B',
      sessionRestarts: 1,
    });
  });
});

describe('withSessionRestart', () => {
  test('increments the restart count and clears the nudge key', () => {
    expect(withSessionRestart({ nudgedSessionKey: 'A', sessionRestarts: 0 })).toEqual({
      nudgedSessionKey: undefined,
      sessionRestarts: 1,
    });
  });

  test('from no entry records one restart with no nudge key', () => {
    expect(withSessionRestart(undefined)).toEqual({
      nudgedSessionKey: undefined,
      sessionRestarts: 1,
    });
  });
});
