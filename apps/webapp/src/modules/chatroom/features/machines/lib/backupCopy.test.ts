import { describe, expect, it } from 'vitest';

import {
  BACKUP_LIMIT_LABEL,
  BACKUP_TIMED_OUT_COPY,
  backupFailureCopy,
  backupMetaLine,
  backupWarningCopy,
  elapsedLabel,
  minutesLeftLabel,
} from './backupCopy';

import { formatTimestampFull } from '@/modules/chatroom/utils/chatroomTimestamp';

describe('backupCopy', () => {
  it('formats the shared 256 MB limit', () => {
    expect(BACKUP_LIMIT_LABEL).toBe('256 MB');
  });

  it.each([
    ['daemon_timeout', BACKUP_TIMED_OUT_COPY, true],
    ['file_missing', 'The backup file is no longer on the machine. Refresh the list.', true],
    ['not_a_file', 'The daemon could not read the backup file.', true],
    ['read_failed', 'The daemon could not read the backup file.', true],
    ['too_large', 'This backup is larger than the 256 MB download limit.', false],
    ['file_changed', 'The backup changed while it was being uploaded. Try again.', true],
    ['upload_failed', 'The upload to the cloud failed. Try again.', true],
    ['size_mismatch', 'The upload to the cloud failed. Try again.', true],
    ['checksum_mismatch', 'The upload to the cloud failed. Try again.', true],
    ['stack_not_found', 'This machine has no local Convex stack.', false],
    ['network', 'The download was interrupted. Try again.', true],
    ['http', 'The download was interrupted. Try again.', true],
    ['aborted', 'The download was stopped.', false],
    ['download_size_mismatch', 'The downloaded size did not match the backup. Try again.', true],
    ['BACKUP_NOT_FOUND', 'This backup is no longer available. Refresh the list.', true],
    [
      'BACKUP_REQUEST_ACTIVE',
      'Another backup download is already in progress on this machine.',
      true,
    ],
    ['something_else', 'Could not download the backup. Try again.', true],
  ])('maps %s to its literal copy', (code, message, retryable) => {
    expect(backupFailureCopy(code)).toEqual({ message, retryable });
  });

  it('formats elapsed time as m:ss', () => {
    expect(elapsedLabel(42_000)).toBe('0:42');
    expect(elapsedLabel(725_000)).toBe('12:05');
  });

  it('formats minutes left with a one-minute floor', () => {
    const now = 1_000_000;
    expect(minutesLeftLabel(now + 58 * 60_000, now)).toBe('58 min');
    expect(minutesLeftLabel(now + 1, now)).toBe('1 min');
    expect(minutesLeftLabel(now - 1, now)).toBe('1 min');
  });

  it('warns about the deployment contents and names the machine', () => {
    const copy = backupWarningCopy('MacBook Pro');
    expect(copy).toContain('bot tokens');
    expect(copy).toContain('MacBook Pro');
    expect(copy).toContain('session data');
  });

  it('joins the known metadata parts with a middle dot', () => {
    const modifiedAt = Date.UTC(2026, 2, 1, 14, 15, 2);
    expect(
      backupMetaLine({
        filename: 'backup-20260301-141502.zip',
        sizeBytes: 138 * 1024 * 1024,
        modifiedAt,
      })
    ).toBe(`backup-20260301-141502.zip · 138 MB · ${formatTimestampFull(modifiedAt)}`);
  });

  it('drops the unknown parts of the metadata line', () => {
    const modifiedAt = Date.UTC(2026, 2, 1, 14, 15, 2);
    expect(
      backupMetaLine({ filename: 'backup-20260301-141502.zip', sizeBytes: null, modifiedAt })
    ).toBe(`backup-20260301-141502.zip · ${formatTimestampFull(modifiedAt)}`);
    expect(
      backupMetaLine({
        filename: 'backup-20260301-141502.zip',
        sizeBytes: null,
        modifiedAt: null,
      })
    ).toBe('backup-20260301-141502.zip');
  });
});
