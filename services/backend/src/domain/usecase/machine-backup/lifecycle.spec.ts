/**
 * Machine backup lifecycle — pure transition and expiry arithmetic.
 *
 * Every expectation is a literal from the design, never recomputed from the implementation.
 */
import { describe, expect, test } from 'vitest';

import {
  confirmPatch,
  downloadStartPatch,
  expiryPatch,
  failPatch,
  preparingPatch,
  readyPatch,
  requestedExpiresAt,
  type BackupRow,
} from './lifecycle';
import type { Id } from '../../../../convex/_generated/dataModel';
import { canTransition, isOrphanBackupBlob, toHexSha256 } from '../../entities/machine-backup';

const SHA256_OF_ABC_HEX = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const SHA256_OF_ABC_BASE64 = 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=';

function row(overrides: Partial<BackupRow> = {}): BackupRow {
  return {
    _id: 'backup-request-1' as Id<'chatroom_machineBackupRequests'>,
    _creationTime: 0,
    userId: 'user-1' as Id<'users'>,
    machineId: 'machine-1',
    kind: 'download',
    status: 'requested',
    createdAt: 0,
    updatedAt: 0,
    expiresAt: 0,
    ...overrides,
  };
}

describe('requestedExpiresAt', () => {
  test('is the routine command window after creation', () => {
    expect(requestedExpiresAt(1_000)).toBe(301_000);
  });
});

describe('preparingPatch', () => {
  test('moves requested to preparing and arms the prepare timeout', () => {
    const outcome = preparingPatch(row({ status: 'requested' }), {
      now: 1_000,
      sizeBytes: 3,
      uploadAttempts: 1,
    });
    expect(outcome.patch).toMatchObject({
      status: 'preparing',
      preparingAt: 1_000,
      sizeBytes: 3,
      uploadAttempts: 1,
      expiresAt: 601_000,
      updatedAt: 1_000,
    });
    expect(outcome.deleteBlob).toBe(false);
  });
});

describe('readyPatch', () => {
  test('moves preparing to ready one hour before expiry', () => {
    const outcome = readyPatch(row({ status: 'preparing' }), {
      now: 2_000,
      sizeBytes: 3,
      sha256Hex: SHA256_OF_ABC_HEX,
      storageId: 'storage-1' as Id<'_storage'>,
    });
    expect(outcome.patch).toMatchObject({
      status: 'ready',
      readyAt: 2_000,
      expiresAt: 3_602_000,
      sha256: SHA256_OF_ABC_HEX,
      sizeBytes: 3,
    });
    expect(outcome.deleteBlob).toBe(false);
  });
});

describe('downloadStartPatch', () => {
  test('restarts the ready window from the download start', () => {
    const outcome = downloadStartPatch(row({ status: 'ready' }), 5_000_000);
    expect(outcome.patch).toMatchObject({
      status: 'downloading',
      lastDownloadStartedAt: 5_000_000,
      expiresAt: 8_600_000,
    });
    expect(outcome.deleteBlob).toBe(false);
  });
});

describe('confirmPatch', () => {
  test('moves downloading to downloaded, clears the blob and holds the row for ten minutes', () => {
    const outcome = confirmPatch(
      row({ status: 'downloading', storageId: 'storage-1' as Id<'_storage'> }),
      9_000_000
    );
    expect(outcome.patch).toMatchObject({
      status: 'downloaded',
      finishedAt: 9_000_000,
      expiresAt: 9_600_000,
      storageId: undefined,
    });
    expect(outcome.deleteBlob).toBe(true);
  });
});

describe('expiryPatch', () => {
  test('expires a ready row that owns a blob', () => {
    const outcome = expiryPatch(
      row({ status: 'ready', storageId: 'storage-1' as Id<'_storage'> }),
      10_000_000
    );
    expect(outcome.patch).toMatchObject({
      status: 'expired',
      finishedAt: 10_000_000,
      expiresAt: 10_600_000,
    });
    expect(outcome.deleteBlob).toBe(true);
  });

  test('fails a preparing row that never reported', () => {
    const outcome = expiryPatch(row({ status: 'preparing' }), 20_000_000);
    expect(outcome.patch).toMatchObject({
      status: 'failed',
      errorCode: 'daemon_timeout',
      finishedAt: 20_000_000,
      expiresAt: 20_600_000,
    });
    expect(outcome.deleteBlob).toBe(false);
  });

  test('throws on a terminal row (the cron deletes it)', () => {
    expect(() => expiryPatch(row({ status: 'downloaded' }), 30_000_000)).toThrow();
  });
});

describe('failPatch', () => {
  test('caps the error message at 500 characters', () => {
    const outcome = failPatch(row({ status: 'preparing' }), {
      now: 1_000,
      errorCode: 'upload_failed',
      errorMessage: 'x'.repeat(600),
    });
    expect(outcome.patch.errorMessage).toHaveLength(500);
  });
});

describe('canTransition', () => {
  test('download table', () => {
    expect(canTransition('download', 'requested', 'preparing')).toBe(true);
    expect(canTransition('download', 'preparing', 'preparing')).toBe(true);
    expect(canTransition('download', 'preparing', 'ready')).toBe(true);
    expect(canTransition('download', 'ready', 'downloading')).toBe(true);
    expect(canTransition('download', 'downloading', 'downloading')).toBe(true);
    expect(canTransition('download', 'downloading', 'downloaded')).toBe(true);
    expect(canTransition('download', 'requested', 'failed')).toBe(true);
    expect(canTransition('download', 'ready', 'expired')).toBe(true);
    expect(canTransition('download', 'ready', 'cancelled')).toBe(true);
    expect(canTransition('download', 'downloaded', 'expired')).toBe(false);
    expect(canTransition('download', 'downloaded', 'cancelled')).toBe(false);
  });

  test('inventory table', () => {
    expect(canTransition('inventory', 'requested', 'completed')).toBe(true);
    expect(canTransition('inventory', 'requested', 'ready')).toBe(false);
  });
});

describe('toHexSha256', () => {
  test('lowercases a hex digest', () => {
    expect(toHexSha256(SHA256_OF_ABC_HEX.toUpperCase())).toBe(SHA256_OF_ABC_HEX);
  });

  test('converts a base64 digest to lowercase hex', () => {
    expect(toHexSha256(SHA256_OF_ABC_BASE64)).toBe(SHA256_OF_ABC_HEX);
  });

  test('rejects anything else', () => {
    expect(toHexSha256('not-a-digest')).toBeNull();
  });
});

describe('isOrphanBackupBlob', () => {
  const contentType = 'application/x-chatroom-machine-backup';

  test('accepts our recent blob', () => {
    expect(isOrphanBackupBlob({ contentType, _creationTime: 1_000 }, 1_000 + 7_200_000)).toBe(true);
  });

  test('rejects a different content type', () => {
    expect(
      isOrphanBackupBlob({ contentType: 'application/zip', _creationTime: 1_000 }, 2_000)
    ).toBe(false);
  });

  test('rejects a blob older than two hours', () => {
    expect(isOrphanBackupBlob({ contentType, _creationTime: 1_000 }, 1_000 + 7_200_001)).toBe(
      false
    );
  });

  test('rejects a blob with no recorded content type', () => {
    expect(isOrphanBackupBlob({ _creationTime: 1_000 }, 2_000)).toBe(false);
  });
});
