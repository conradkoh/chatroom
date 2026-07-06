import { describe, expect, it } from 'vitest';

import { resolveResumableHarnessSessionId } from './resolve-resumable-harness-session-id.js';

describe('resolveResumableHarnessSessionId', () => {
  it('returns resumableHarnessSessionId when set', () => {
    expect(
      resolveResumableHarnessSessionId({
        harnessSessionId: 'correlation-uuid',
        resumableHarnessSessionId: 'provider-sess-1',
      })
    ).toBe('provider-sess-1');
  });

  it('falls back to harnessSessionId when resumable is unset', () => {
    expect(
      resolveResumableHarnessSessionId({
        harnessSessionId: 'correlation-uuid',
      })
    ).toBe('correlation-uuid');
  });
});
