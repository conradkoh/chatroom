import { describe, expect, it } from 'vitest';

import { formatFileWriteError } from './fileWriteErrorFormatting';

describe('formatFileWriteError', () => {
  it('maps Missing file data for mkdir to upgrade message', () => {
    const msg = formatFileWriteError('Missing file data', 'mkdir');
    expect(msg).toContain('mkdir');
    expect(msg).toContain('upgrade');
    expect(msg).not.toBe('Missing file data');
  });

  it('maps Missing file data for rename to upgrade message', () => {
    const msg = formatFileWriteError('Missing file data', 'rename');
    expect(msg).toContain('rename');
  });

  it('preserves Missing file data for create (legitimate error)', () => {
    expect(formatFileWriteError('Missing file data', 'create')).toBe('Missing file data');
  });

  it('passes through already-formatted unsupported operation errors', () => {
    const daemon = 'Unsupported file write operation "mkdir". Please upgrade...';
    expect(formatFileWriteError(daemon, 'mkdir')).toBe(daemon);
  });

  it('passes through unrelated errors unchanged', () => {
    expect(formatFileWriteError('Directory already exists', 'mkdir')).toBe(
      'Directory already exists'
    );
  });
});
