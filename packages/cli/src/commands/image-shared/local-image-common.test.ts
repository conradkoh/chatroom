import { describe, expect, it } from 'vitest';

import { median } from './local-image-common.js';

describe('median', () => {
  it('returns the middle value for an odd-length input', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages and rounds the two middle values for an even-length input', () => {
    expect(median([1, 2, 3, 4])).toBe(3);
  });

  it('returns a single value unchanged', () => {
    expect(median([7])).toBe(7);
  });

  it('sorts an unsorted input before choosing the middle', () => {
    expect(median([10, 1, 4, 2, 8])).toBe(4);
  });
});
