import { describe, expect, test } from 'vitest';

import { BACKUP_MAX_BYTES, isBackupFilename } from './machine-backup';

describe('isBackupFilename', () => {
  test('accepts the local stack naming pattern', () => {
    expect(isBackupFilename('backup-20260101-123456.zip')).toBe(true);
  });

  test.each([
    '../backup-20260101-123456.zip',
    'backup-1.zip',
    'backup-20260101-123456.zip.bak',
    'chatroom-all-m1-20260101T000000Z.json',
    'backup-20260101-123456.zip\n',
  ])('rejects %j', (name) => {
    expect(isBackupFilename(name)).toBe(false);
  });
});

describe('BACKUP_MAX_BYTES', () => {
  test('is 256 MiB', () => {
    expect(BACKUP_MAX_BYTES).toBe(268435456);
  });
});
