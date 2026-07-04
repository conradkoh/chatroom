import { describe, expect, it } from 'vitest';

import { computeDirListingContentHash } from './dir-listing-content-hash.js';

describe('computeDirListingContentHash', () => {
  it('is stable when only scannedAt would differ', () => {
    const entries = [{ name: 'a.ts', path: 'a.ts', type: 'file' as const }];
    const a = computeDirListingContentHash({ entries, truncated: false, totalCount: 1 });
    const b = computeDirListingContentHash({ entries, truncated: false, totalCount: 1 });
    expect(a).toBe(b);
  });

  it('changes when entries change', () => {
    const base = { truncated: false, totalCount: 1 };
    const h1 = computeDirListingContentHash({
      entries: [{ name: 'a.ts', path: 'a.ts', type: 'file' }],
      ...base,
    });
    const h2 = computeDirListingContentHash({
      entries: [{ name: 'b.ts', path: 'b.ts', type: 'file' }],
      ...base,
    });
    expect(h1).not.toBe(h2);
  });
});
