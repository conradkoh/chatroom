import { describe, expect, test } from 'vitest';
import { formatBackupFilename, resolveBackupPath } from './convex-backup.js';

describe('formatBackupFilename', () => {
  test('formats filename with UTC timestamp', () => {
    const now = new Date('2026-07-22T16:30:45.000Z');
    expect(formatBackupFilename(now)).toBe('backup-20260722-163045.zip');
  });

  test('pads single-digit months and days', () => {
    const now = new Date('2026-01-05T01:02:03.000Z');
    expect(formatBackupFilename(now)).toBe('backup-20260105-010203.zip');
  });
});

describe('resolveBackupPath', () => {
  test('accepts valid backup id', () => {
    const result = resolveBackupPath('/repo', 'backup-20260722-163045.zip');
    expect(result).toMatch(/backup-20260722-163045\.zip$/);
  });

  test('rejects invalid backup id', () => {
    expect(() => resolveBackupPath('/repo', 'backup-20260722-163045')).toThrow('Invalid backup id');
    expect(() => resolveBackupPath('/repo', 'foo.zip')).toThrow('Invalid backup id');
    expect(() => resolveBackupPath('/repo', '../malicious')).toThrow('Invalid backup id');
  });
});
