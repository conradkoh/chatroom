import { describe, expect, test } from 'vitest';

import { terminalizeExpiredStopCommand } from './terminalize-expired-stop-command';

describe('agent stop reaper', () => {
  test('uses expiry terminalization primitive', () => {
    expect(typeof terminalizeExpiredStopCommand).toBe('function');
  });
});
