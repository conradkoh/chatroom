import { describe, expect, it } from 'vitest';

import { formatBytes } from './format-bytes.js';

describe('formatBytes', () => {
  it('prints bytes below one KiB without a decimal', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('prints KiB and MiB with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KiB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MiB');
  });
});
