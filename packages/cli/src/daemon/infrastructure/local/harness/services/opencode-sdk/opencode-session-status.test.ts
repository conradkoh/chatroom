import { describe, expect, it } from 'vitest';

import { parseOpenCodeSessionStatus } from './opencode-session-status.js';

describe('opencode-session-status', () => {
  it('parses known statuses', () => {
    expect(parseOpenCodeSessionStatus('idle')).toBe('idle');
    expect(parseOpenCodeSessionStatus('busy')).toBe('busy');
    expect(parseOpenCodeSessionStatus('retry')).toBe('retry');
  });

  it('rejects unknown / non-string', () => {
    expect(parseOpenCodeSessionStatus('compacting')).toBeNull();
    expect(parseOpenCodeSessionStatus(undefined)).toBeNull();
    expect(parseOpenCodeSessionStatus(1)).toBeNull();
  });
});
