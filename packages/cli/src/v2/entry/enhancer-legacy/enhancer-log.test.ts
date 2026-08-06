import { describe, it, expect } from 'vitest';

import { ENHANCER_LOG_PREFIX, formatEnhancerLogLine } from './enhancer-log.js';

describe('formatEnhancerLogLine', () => {
  it('prefixes plain messages', () => {
    expect(formatEnhancerLogLine('claimed job=abc')).toBe('[enhancer] claimed job=abc');
  });
  it('does not double-prefix', () => {
    expect(formatEnhancerLogLine(`${ENHANCER_LOG_PREFIX} already prefixed`)).toBe(
      `${ENHANCER_LOG_PREFIX} already prefixed`
    );
  });
  it('preserves harness log content after prefix', () => {
    const harnessLine = '[2026-07-25T00:00:00.000Z] role:enhancer text] hello';
    expect(formatEnhancerLogLine(harnessLine)).toBe(`[enhancer] ${harnessLine}`);
  });
});
