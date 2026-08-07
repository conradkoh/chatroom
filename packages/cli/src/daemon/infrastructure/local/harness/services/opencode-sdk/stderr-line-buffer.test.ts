import { describe, expect, test, vi } from 'vitest';

import { StderrLineBuffer } from './stderr-line-buffer.js';

describe('StderrLineBuffer', () => {
  test('emits complete lines only', () => {
    const onLine = vi.fn();
    const buffer = new StderrLineBuffer(onLine);

    buffer.append('Rate lim');
    expect(onLine).not.toHaveBeenCalled();

    buffer.append('it exceeded\n');
    expect(onLine).toHaveBeenCalledTimes(1);
    expect(onLine).toHaveBeenCalledWith('Rate limit exceeded');
  });

  test('handles multiple lines in one chunk', () => {
    const onLine = vi.fn();
    const buffer = new StderrLineBuffer(onLine);

    buffer.append('line one\nline two\npartial');
    expect(onLine).toHaveBeenCalledTimes(2);
    expect(onLine).toHaveBeenNthCalledWith(1, 'line one');
    expect(onLine).toHaveBeenNthCalledWith(2, 'line two');
  });

  test('flush emits trailing partial line', () => {
    const onLine = vi.fn();
    const buffer = new StderrLineBuffer(onLine);

    buffer.append('trailing partial');
    buffer.flush();
    expect(onLine).toHaveBeenCalledWith('trailing partial');
  });
});
