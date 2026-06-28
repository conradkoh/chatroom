import { describe, it, expect } from 'vitest';

import {
  effectiveSessionStatus,
  isTerminalSessionStatus,
  pruneConfirmedClosedIds,
} from './sessionStatus';

describe('sessionStatus', () => {
  it('effectiveSessionStatus returns closed when optimistically closed', () => {
    const ids = new Set(['s1']);
    expect(effectiveSessionStatus('active', 's1', ids)).toBe('closed');
    expect(effectiveSessionStatus('active', 's2', ids)).toBe('active');
  });

  it('isTerminalSessionStatus identifies closed and failed', () => {
    expect(isTerminalSessionStatus('closed')).toBe(true);
    expect(isTerminalSessionStatus('failed')).toBe(true);
    expect(isTerminalSessionStatus('active')).toBe(false);
  });

  it('pruneConfirmedClosedIds removes ids confirmed closed on the server', () => {
    const ids = new Set(['s1', 's2']);
    const sessions = [
      { _id: 's1', status: 'closed' as const },
      { _id: 's2', status: 'active' as const },
    ];
    expect(pruneConfirmedClosedIds(ids, sessions)).toEqual(new Set(['s2']));
  });
});
