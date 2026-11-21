import { describe, expect, it } from 'bun:test';

import { describeMigrationError } from './migrate-lib';

describe('describeMigrationError', () => {
  it('prefers the trimmed stderr of a failed convex run', () => {
    expect(describeMigrationError({ stderr: Buffer.from('migrations:x failed: boom\n') })).toBe(
      'migrations:x failed: boom'
    );
  });

  it('falls back to the error message, then to the string form', () => {
    expect(describeMigrationError(new Error('plain'))).toBe('plain');
    expect(describeMigrationError('text')).toBe('text');
  });

  it('treats an undefined stderr as absent and keeps the error message', () => {
    expect(
      describeMigrationError(
        Object.assign(new Error('connect ECONNREFUSED'), { stderr: undefined })
      )
    ).toBe('connect ECONNREFUSED');
  });
});
