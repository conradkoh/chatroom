import { afterEach, describe, expect, it, vi } from 'vitest';

import { tapProcessStreamWrites } from './tap-process-stream-writes.js';

describe('tapProcessStreamWrites', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it('invokes onWrite for direct stdout and stderr writes', () => {
    const onWrite = vi.fn();
    restore = tapProcessStreamWrites(onWrite);

    process.stdout.write('hello stdout\n');
    process.stderr.write('hello stderr\n');

    expect(onWrite).toHaveBeenCalledTimes(2);
  });

  it('stops forwarding after restore', () => {
    const onWrite = vi.fn();
    restore = tapProcessStreamWrites(onWrite);
    restore();
    restore = undefined;

    onWrite.mockClear();
    process.stdout.write('after restore\n');
    expect(onWrite).not.toHaveBeenCalled();
  });
});
