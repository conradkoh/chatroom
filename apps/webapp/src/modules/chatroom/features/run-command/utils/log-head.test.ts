import { describe, expect, test } from 'vitest';

import { LOG_HEAD_LINE_COUNT, formatLogHead, formatLogHeadFromLines } from './log-head';

describe('formatLogHead', () => {
  test('returns full output when within line limit', () => {
    const output = 'line1\nline2\nline3';
    expect(formatLogHead(output)).toBe(output);
  });

  test('truncates output beyond line limit with summary', () => {
    const lines = Array.from({ length: LOG_HEAD_LINE_COUNT + 50 }, (_, i) => `line${i + 1}`);
    const fullOutput = lines.join('\n');
    const result = formatLogHead(fullOutput);

    expect(result).toContain('line1');
    expect(result).toContain(`line${LOG_HEAD_LINE_COUNT}`);
    expect(result).not.toContain(`line${LOG_HEAD_LINE_COUNT + 1}`);
    expect(result).toContain('… (50 more lines)');
  });

  test('formatLogHeadFromLines delegates to formatLogHead', () => {
    const lines = ['alpha', 'beta', 'gamma'];
    expect(formatLogHeadFromLines(lines)).toBe(formatLogHead(lines.join('\n')));
  });
});
