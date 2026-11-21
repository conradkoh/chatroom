import { describe, expect, it } from 'vitest';

import { computePdfPageSlices } from './computePdfPageSlices';

describe('computePdfPageSlices', () => {
  it('returns a single slice when every block fits on one page', () => {
    const blocks = [
      { top: 0, bottom: 300 },
      { top: 300, bottom: 600 },
      { top: 600, bottom: 900 },
    ];

    expect(computePdfPageSlices(blocks, 1000, 900)).toEqual([{ start: 0, end: 900 }]);
  });

  it('breaks on block boundaries instead of cutting mid-block', () => {
    const blocks = [
      { top: 0, bottom: 300 },
      { top: 300, bottom: 600 },
      { top: 600, bottom: 900 },
    ];

    expect(computePdfPageSlices(blocks, 500, 900)).toEqual([
      { start: 0, end: 300 },
      { start: 300, end: 600 },
      { start: 600, end: 900 },
    ]);
  });

  it('hard-cuts a block taller than one page', () => {
    const blocks = [{ top: 0, bottom: 1200 }];

    expect(computePdfPageSlices(blocks, 500, 1200)).toEqual([
      { start: 0, end: 500 },
      { start: 500, end: 1000 },
      { start: 1000, end: 1200 },
    ]);
  });

  it('starts an oversize block on a fresh page after a short block', () => {
    const blocks = [
      { top: 0, bottom: 100 },
      { top: 100, bottom: 1100 },
    ];

    expect(computePdfPageSlices(blocks, 500, 1100)).toEqual([
      { start: 0, end: 100 },
      { start: 100, end: 600 },
      { start: 600, end: 1100 },
    ]);
  });

  it('hard-cuts the trailing region when there are no blocks', () => {
    expect(computePdfPageSlices([], 500, 1100)).toEqual([
      { start: 0, end: 500 },
      { start: 500, end: 1000 },
      { start: 1000, end: 1100 },
    ]);
  });

  it('returns no slices for empty content', () => {
    expect(computePdfPageSlices([], 500, 0)).toEqual([]);
  });

  it('throws when pageHeight is not positive', () => {
    expect(() => computePdfPageSlices([], 0, 100)).toThrow('pageHeight must be positive');
  });
});
