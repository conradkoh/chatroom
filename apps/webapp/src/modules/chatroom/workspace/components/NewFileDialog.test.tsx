import { describe, expect, it } from 'vitest';

import { normalizeNewFilePath, validateRelativeFilePath } from '../utils/gzipContent';

describe('validateRelativeFilePath', () => {
  it('rejects path traversal', () => {
    expect(validateRelativeFilePath('../etc/passwd')).toBe('Path traversal is not allowed');
  });

  it('rejects absolute paths', () => {
    expect(validateRelativeFilePath('/etc/passwd')).toBe('Absolute paths are not allowed');
  });

  it('accepts safe relative paths', () => {
    expect(validateRelativeFilePath('docs/notes.md')).toBeNull();
  });
});

describe('normalizeNewFilePath', () => {
  it('appends .md when no extension is provided', () => {
    expect(normalizeNewFilePath('notes')).toBe('notes.md');
  });

  it('preserves explicit markdown extension', () => {
    expect(normalizeNewFilePath('docs/guide.md')).toBe('docs/guide.md');
  });
});
