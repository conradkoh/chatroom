/**
 * Machine backup requests — state, authorization and blob lifecycle through the real schema.
 *
 * Only `api.machineBackups.*` and `internal.machineBackups.cleanupExpiredBackupRequests` are
 * exercised. Blobs are real `_storage` documents; the expected digest is the literal SHA-256 of
 * "abc".
 */
import { BACKUP_UPLOAD_CONTENT_TYPE } from '@workspace/shared/domain/machine-backup';
import type { SessionId } from 'convex-helpers/server/sessions';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { t } from '../test.setup';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { createTestSession, registerMachineWithDaemon } from '../tests/helpers/integration';
import { getInboxCommandsForMachine } from '../tests/helpers/machine-command-inbox';

const SHA256_OF_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const BACKUP_FILENAME = 'backup-20260101-123456.zip';
const OTHER_BACKUP_FILENAME = 'backup-20260102-000000.zip';

let sequence = 0;

interface Owner {
  sessionId: SessionId;
  machineId: string;
}

async function registerOwner(options: { online?: boolean } = {}): Promise<Owner> {
  sequence += 1;
  const sessionId = `machine-backup-session-${sequence}` as SessionId;
  const machineId = `machine-backup-machine-${sequence}`;
  await createTestSession(sessionId);
  if (options.online === false) {
    await t.mutation(api.machines.register, {
      sessionId,
      machineId,
      hostname: 'backup-host',
      os: 'darwin',
      availableHarnesses: ['opencode-sdk'],
    });
  } else {
    await registerMachineWithDaemon(sessionId, machineId);
  }
  return { sessionId, machineId };
}

async function createDownload(owner: Owner, filename = BACKUP_FILENAME) {
  return t.mutation(api.machineBackups.createDownloadRequest, {
    sessionId: owner.sessionId,
    machineId: owner.machineId,
    filename,
  });
}

/** Stores "abc" and records our content type, as a real upload does. */
async function storeAbc(): Promise<Id<'_storage'>> {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob(['abc'])));
  // convex-test's `_storage` documents carry no `contentType`; the backend records the upload header.
  await t.run((ctx) =>
    ctx.db.patch('_storage' as never, storageId, {
      contentType: BACKUP_UPLOAD_CONTENT_TYPE,
    } as never)
  );
  return storageId;
}

/** Stores "abc" exactly as convex-test does, with no content type recorded. */
async function storeUntypedAbc(): Promise<Id<'_storage'>> {
  return t.run((ctx) => ctx.storage.store(new Blob(['abc'])));
}

async function getRow(requestId: Id<'chatroom_machineBackupRequests'>) {
  return t.run((ctx) => ctx.db.get('chatroom_machineBackupRequests', requestId));
}

async function getStorageDoc(storageId: Id<'_storage'>) {
  return t.run((ctx) => ctx.db.system.get('_storage', storageId));
}

async function countStorage(): Promise<number> {
  return t.run(async (ctx) => (await ctx.db.system.query('_storage').collect()).length);
}

/** Drives a download request to `ready` with the three bytes "abc". */
async function prepareReady(
  owner: Owner,
  filename = BACKUP_FILENAME
): Promise<{ requestId: Id<'chatroom_machineBackupRequests'>; storageId: Id<'_storage'> }> {
  const { requestId } = await createDownload(owner, filename);
  const upload = await t.mutation(api.machineBackups.createUploadUrl, {
    sessionId: owner.sessionId,
    machineId: owner.machineId,
    requestId,
    sizeBytes: 3,
  });
  expect(upload.ok).toBe(true);
  const storageId = await storeAbc();
  const report = await t.mutation(api.machineBackups.reportUploaded, {
    sessionId: owner.sessionId,
    machineId: owner.machineId,
    requestId,
    storageId,
    sizeBytes: 3,
    sha256: SHA256_OF_ABC,
    stable: true,
  });
  expect(report).toEqual({ ok: true });
  return { requestId, storageId };
}

function useTime(now: number): void {
  vi.useFakeTimers();
  vi.setSystemTime(now);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('machineBackups authorization', () => {
  test('a non-owner sees the same result as a missing resource', async () => {
    const owner = await registerOwner();
    const stranger = await registerOwner();
    const { requestId, storageId } = await prepareReady(owner);

    expect(
      await t.query(api.machineBackups.getRequest, {
        sessionId: stranger.sessionId,
        requestId,
      })
    ).toBeNull();
    expect(
      await t.query(api.machineBackups.getActiveDownload, {
        sessionId: stranger.sessionId,
        machineId: owner.machineId,
      })
    ).toBeNull();

    await expect(
      t.mutation(api.machineBackups.createInventoryRequest, {
        sessionId: stranger.sessionId,
        machineId: owner.machineId,
      })
    ).rejects.toMatchObject({ data: { code: 'BACKUP_NOT_FOUND' } });
    await expect(
      t.mutation(api.machineBackups.createDownloadRequest, {
        sessionId: stranger.sessionId,
        machineId: owner.machineId,
        filename: OTHER_BACKUP_FILENAME,
      })
    ).rejects.toMatchObject({ data: { code: 'BACKUP_NOT_FOUND' } });

    const foreignAccess = await t.mutation(api.machineBackups.createDownloadAccess, {
      sessionId: stranger.sessionId,
      requestId,
    });
    expect(foreignAccess).toEqual({ ok: false, reason: 'not_found' });

    // An id that resolves to nothing produces the same response.
    const missingId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', {
        type: 'anonymous',
        name: 'missing-backup-owner',
      });
      const id = await ctx.db.insert('chatroom_machineBackupRequests', {
        userId,
        machineId: owner.machineId,
        kind: 'download',
        status: 'ready',
        createdAt: 0,
        updatedAt: 0,
        expiresAt: 0,
        filename: BACKUP_FILENAME,
      });
      await ctx.db.delete('chatroom_machineBackupRequests', id);
      return id;
    });
    const missingAccess = await t.mutation(api.machineBackups.createDownloadAccess, {
      sessionId: stranger.sessionId,
      requestId: missingId,
    });
    expect(missingAccess).toEqual(foreignAccess);

    const before = await getRow(requestId);
    expect(
      await t.mutation(api.machineBackups.cancelRequest, {
        sessionId: stranger.sessionId,
        requestId,
      })
    ).toEqual({ ok: true });
    expect(await getRow(requestId)).toEqual(before);
    expect((await getStorageDoc(storageId))?.size).toBe(3);
  });
});

describe('machineBackups offline machine', () => {
  test('both create functions reject when the daemon is offline', async () => {
    const owner = await registerOwner({ online: false });

    await expect(
      t.mutation(api.machineBackups.createInventoryRequest, {
        sessionId: owner.sessionId,
        machineId: owner.machineId,
      })
    ).rejects.toMatchObject({ data: { code: 'MACHINE_OFFLINE' } });
    await expect(createDownload(owner, OTHER_BACKUP_FILENAME)).rejects.toMatchObject({
      data: { code: 'MACHINE_OFFLINE' },
    });
  });
});

describe('machineBackups inventory', () => {
  test('reuses a pending request and caps the snapshot at 200 entries', async () => {
    const owner = await registerOwner();

    const first = await t.mutation(api.machineBackups.createInventoryRequest, {
      sessionId: owner.sessionId,
      machineId: owner.machineId,
    });
    expect(first.reused).toBe(false);
    expect(
      await getInboxCommandsForMachine(owner.machineId, 'daemon.reportMachineBackups')
    ).toHaveLength(1);

    const second = await t.mutation(api.machineBackups.createInventoryRequest, {
      sessionId: owner.sessionId,
      machineId: owner.machineId,
    });
    expect(second).toEqual({ requestId: first.requestId, reused: true });
    expect(
      await getInboxCommandsForMachine(owner.machineId, 'daemon.reportMachineBackups')
    ).toHaveLength(1);

    const entries = Array.from({ length: 201 }, (_, index) => ({
      filename: BACKUP_FILENAME,
      sizeBytes: index,
      modifiedAt: index,
    }));
    const report = await t.mutation(api.machineBackups.reportInventory, {
      sessionId: owner.sessionId,
      machineId: owner.machineId,
      requestId: first.requestId,
      status: 'completed',
      inventoryDir: '/backups',
      stackFound: true,
      backups: entries,
      totalCount: 201,
      totalBytes: 201,
      newestAt: 200,
    });
    expect(report).toEqual({ ok: true });

    const view = await t.query(api.machineBackups.getRequest, {
      sessionId: owner.sessionId,
      requestId: first.requestId,
    });
    expect(view?.status).toBe('completed');
    expect(view?.backups).toHaveLength(200);
    expect(view?.truncated).toBe(true);
    expect(view?.finishedAt).toBeDefined();
    expect(view!.expiresAt - view!.finishedAt!).toBe(600000);

    expect(
      await t.mutation(api.machineBackups.reportInventory, {
        sessionId: owner.sessionId,
        machineId: owner.machineId,
        requestId: first.requestId,
        status: 'completed',
      })
    ).toEqual({ ok: true, duplicate: true });
  });
});

describe('machineBackups download request', () => {
  test('validates the filename, enqueues once and rejects a second active file', async () => {
    const owner = await registerOwner();

    await expect(createDownload(owner, '../x.zip')).rejects.toMatchObject({
      data: { code: 'BACKUP_INVALID_FILENAME' },
    });

    const created = await createDownload(owner, BACKUP_FILENAME);
    expect(created.reused).toBe(false);
    expect(
      await getInboxCommandsForMachine(owner.machineId, 'daemon.uploadMachineBackup')
    ).toHaveLength(1);

    expect(await createDownload(owner, BACKUP_FILENAME)).toEqual({
      requestId: created.requestId,
      reused: true,
    });
    await expect(createDownload(owner, OTHER_BACKUP_FILENAME)).rejects.toMatchObject({
      data: { code: 'BACKUP_REQUEST_ACTIVE' },
    });
  });
});

describe('machineBackups full lifecycle', () => {
  test('create → upload → ready → download access → confirm deletes the blob', async () => {
    const owner = await registerOwner();
    const { requestId } = await createDownload(owner);

    const upload = await t.mutation(api.machineBackups.createUploadUrl, {
      sessionId: owner.sessionId,
      machineId: owner.machineId,
      requestId,
      sizeBytes: 3,
    });
    expect(upload.ok && upload.uploadUrl.startsWith('https://')).toBe(true);

    const storageId = await storeAbc();
    expect(
      await t.mutation(api.machineBackups.reportUploaded, {
        sessionId: owner.sessionId,
        machineId: owner.machineId,
        requestId,
        storageId,
        sizeBytes: 3,
        sha256: SHA256_OF_ABC,
        stable: true,
      })
    ).toEqual({ ok: true });
    expect((await getRow(requestId))?.status).toBe('ready');

    const access = await t.mutation(api.machineBackups.createDownloadAccess, {
      sessionId: owner.sessionId,
      requestId,
    });
    expect(access.ok).toBe(true);
    if (access.ok) expect(access.url.startsWith('https://')).toBe(true);
    expect((await getRow(requestId))?.status).toBe('downloading');

    const projection = JSON.stringify(
      await t.query(api.machineBackups.getRequest, { sessionId: owner.sessionId, requestId })
    );
    expect(projection).not.toContain('storageId');
    expect(projection).not.toContain('sha256');
    expect(projection).not.toContain('https://');

    expect(
      await t.mutation(api.machineBackups.writeDownloadConfirmation, {
        sessionId: owner.sessionId,
        requestId,
        receivedBytes: 3,
      })
    ).toEqual({ ok: true });

    const row = await getRow(requestId);
    expect(row?.status).toBe('downloaded');
    expect(row?.storageId).toBeUndefined();
    expect(await getStorageDoc(storageId)).toBeNull();

    expect(
      await t.mutation(api.machineBackups.writeDownloadConfirmation, {
        sessionId: owner.sessionId,
        requestId,
        receivedBytes: 3,
      })
    ).toEqual({ ok: true, duplicate: true });
  });
});

describe('machineBackups size gate', () => {
  test('rejects a backup larger than 256 MiB without writing a blob', async () => {
    const owner = await registerOwner();
    const { requestId } = await createDownload(owner);
    const before = await countStorage();

    expect(
      await t.mutation(api.machineBackups.createUploadUrl, {
        sessionId: owner.sessionId,
        machineId: owner.machineId,
        requestId,
        sizeBytes: 268435457,
      })
    ).toEqual({ ok: false, reason: 'too_large' });

    const row = await getRow(requestId);
    expect(row?.status).toBe('failed');
    expect(row?.errorCode).toBe('too_large');
    expect(await countStorage()).toBe(before);
  });
});

describe('machineBackups upload attempts', () => {
  test('fails after the third minted upload URL', async () => {
    const owner = await registerOwner();
    const { requestId } = await createDownload(owner);

    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await t.mutation(api.machineBackups.createUploadUrl, {
        sessionId: owner.sessionId,
        machineId: owner.machineId,
        requestId,
        sizeBytes: 3,
      });
      expect(result.ok, `attempt ${attempt}`).toBe(true);
    }

    expect(
      await t.mutation(api.machineBackups.createUploadUrl, {
        sessionId: owner.sessionId,
        machineId: owner.machineId,
        requestId,
        sizeBytes: 3,
      })
    ).toEqual({ ok: false, reason: 'attempts_exhausted' });
  });
});

describe('machineBackups checksum mismatch', () => {
  test('fails the row and deletes the blob when the digest differs', async () => {
    const owner = await registerOwner();
    const { requestId } = await createDownload(owner);
    await t.mutation(api.machineBackups.createUploadUrl, {
      sessionId: owner.sessionId,
      machineId: owner.machineId,
      requestId,
      sizeBytes: 3,
    });
    const storageId = await storeAbc();

    const report = await t.mutation(api.machineBackups.reportUploaded, {
      sessionId: owner.sessionId,
      machineId: owner.machineId,
      requestId,
      storageId,
      sizeBytes: 3,
      sha256: 'a'.repeat(64),
      stable: true,
    });

    expect(report).toEqual({ ok: false, reason: 'checksum_mismatch' });
    expect(await getStorageDoc(storageId)).toBeNull();
    const row = await getRow(requestId);
    expect(row?.status).toBe('failed');
    expect(row?.errorCode).toBe('checksum_mismatch');
  });
});

describe('machineBackups confirmation size mismatch', () => {
  test('keeps the row downloading and the blob present', async () => {
    const owner = await registerOwner();
    const { requestId, storageId } = await prepareReady(owner);
    await t.mutation(api.machineBackups.createDownloadAccess, {
      sessionId: owner.sessionId,
      requestId,
    });

    expect(
      await t.mutation(api.machineBackups.writeDownloadConfirmation, {
        sessionId: owner.sessionId,
        requestId,
        receivedBytes: 2,
      })
    ).toEqual({ ok: false, reason: 'size_mismatch' });

    expect((await getRow(requestId))?.status).toBe('downloading');
    expect(await getStorageDoc(storageId)).not.toBeNull();
  });
});

describe('machineBackups file changed', () => {
  test('fails the row and deletes the blob when the file was not stable', async () => {
    const owner = await registerOwner();
    const { requestId } = await createDownload(owner);
    await t.mutation(api.machineBackups.createUploadUrl, {
      sessionId: owner.sessionId,
      machineId: owner.machineId,
      requestId,
      sizeBytes: 3,
    });
    const storageId = await storeAbc();

    const report = await t.mutation(api.machineBackups.reportUploaded, {
      sessionId: owner.sessionId,
      machineId: owner.machineId,
      requestId,
      storageId,
      sizeBytes: 3,
      sha256: SHA256_OF_ABC,
      stable: false,
    });

    expect(report).toEqual({ ok: false, reason: 'file_changed' });
    expect(await getStorageDoc(storageId)).toBeNull();
    expect((await getRow(requestId))?.status).toBe('failed');
  });
});

describe('machineBackups content type', () => {
  test('rejects a blob with no recorded content type', async () => {
    const owner = await registerOwner();
    const { requestId } = await createDownload(owner);
    await t.mutation(api.machineBackups.createUploadUrl, {
      sessionId: owner.sessionId,
      machineId: owner.machineId,
      requestId,
      sizeBytes: 3,
    });
    const storageId = await storeUntypedAbc();

    const report = await t.mutation(api.machineBackups.reportUploaded, {
      sessionId: owner.sessionId,
      machineId: owner.machineId,
      requestId,
      storageId,
      sizeBytes: 3,
      sha256: SHA256_OF_ABC,
      stable: true,
    });

    expect(report).toEqual({ ok: false, reason: 'upload_failed' });
    expect(await getStorageDoc(storageId)).toBeNull();
    const row = await getRow(requestId);
    expect(row?.status).toBe('failed');
    expect(row?.errorCode).toBe('upload_failed');
  });
});

describe('machineBackups cancel', () => {
  test('cancels a ready row, deletes the blob and ignores a second cancel', async () => {
    const owner = await registerOwner();
    const { requestId, storageId } = await prepareReady(owner);

    expect(
      await t.mutation(api.machineBackups.cancelRequest, {
        sessionId: owner.sessionId,
        requestId,
      })
    ).toEqual({ ok: true });

    const cancelled = await getRow(requestId);
    expect(cancelled?.status).toBe('cancelled');
    expect(await getStorageDoc(storageId)).toBeNull();

    expect(
      await t.mutation(api.machineBackups.cancelRequest, {
        sessionId: owner.sessionId,
        requestId,
      })
    ).toEqual({ ok: true });
    expect(await getRow(requestId)).toEqual(cancelled);
  });
});

describe('machineBackups expiry', () => {
  test('expires a ready copy one hour later, then deletes the row after retention', async () => {
    const start = 1_700_000_000_000;
    useTime(start);
    const owner = await registerOwner();
    const { requestId, storageId } = await prepareReady(owner);

    vi.setSystemTime(start + 3_600_001);
    await t.mutation(internal.machineBackups.cleanupExpiredBackupRequests, {});

    expect((await getRow(requestId))?.status).toBe('expired');
    expect(await getStorageDoc(storageId)).toBeNull();

    vi.setSystemTime(start + 3_600_001 + 600_001);
    await t.mutation(internal.machineBackups.cleanupExpiredBackupRequests, {});
    expect(await getRow(requestId)).toBeNull();
  });
});

describe('machineBackups restart extends expiry', () => {
  test('a started download gets a fresh hour, and the cron respects it', async () => {
    const start = 1_700_000_000_000;
    useTime(start);
    const owner = await registerOwner();
    const { requestId, storageId } = await prepareReady(owner);

    vi.setSystemTime(start + 50 * 60_000);
    const access = await t.mutation(api.machineBackups.createDownloadAccess, {
      sessionId: owner.sessionId,
      requestId,
    });
    expect(access.ok).toBe(true);

    vi.setSystemTime(start + 70 * 60_000);
    await t.mutation(internal.machineBackups.cleanupExpiredBackupRequests, {});
    const stillDownloading = await getRow(requestId);
    expect(stillDownloading?.status).toBe('downloading');
    expect(stillDownloading?.expiresAt).toBe(start + 110 * 60_000);

    vi.setSystemTime(start + 111 * 60_000);
    await t.mutation(internal.machineBackups.cleanupExpiredBackupRequests, {});
    expect((await getRow(requestId))?.status).toBe('expired');
    expect(await getStorageDoc(storageId)).toBeNull();
  });
});

describe('machineBackups late report', () => {
  test('a report for a cancelled row is a duplicate and the typed orphan is deleted', async () => {
    const owner = await registerOwner();
    const { requestId } = await createDownload(owner);
    await t.mutation(api.machineBackups.createUploadUrl, {
      sessionId: owner.sessionId,
      machineId: owner.machineId,
      requestId,
      sizeBytes: 3,
    });
    const storageId = await storeAbc();
    await t.mutation(api.machineBackups.cancelRequest, {
      sessionId: owner.sessionId,
      requestId,
    });

    expect(
      await t.mutation(api.machineBackups.reportUploaded, {
        sessionId: owner.sessionId,
        machineId: owner.machineId,
        requestId,
        storageId,
        sizeBytes: 3,
        sha256: SHA256_OF_ABC,
        stable: true,
      })
    ).toEqual({ ok: true, duplicate: true });

    // The cancelled row never recorded the blob, so it is a typed, recent orphan and is deleted.
    expect(await getStorageDoc(storageId)).toBeNull();
  });
});

describe('machineBackups projection', () => {
  test('queries never expose storageId, sha256 or a URL', async () => {
    const owner = await registerOwner();
    const { requestId } = await prepareReady(owner);

    const byId = JSON.stringify(
      await t.query(api.machineBackups.getRequest, { sessionId: owner.sessionId, requestId })
    );
    const active = JSON.stringify(
      await t.query(api.machineBackups.getActiveDownload, {
        sessionId: owner.sessionId,
        machineId: owner.machineId,
      })
    );

    for (const projection of [byId, active]) {
      expect(projection).not.toContain('storageId');
      expect(projection).not.toContain('sha256');
      expect(projection).not.toContain('https://');
    }
  });
});

describe('machineBackups concurrent confirm and cron', () => {
  test('expiring at the same moment never throws and leaves no blob', async () => {
    const start = 1_700_000_000_000;
    useTime(start);
    const owner = await registerOwner();
    const { requestId, storageId } = await prepareReady(owner);
    await t.mutation(api.machineBackups.createDownloadAccess, {
      sessionId: owner.sessionId,
      requestId,
    });

    vi.setSystemTime(start + 3_600_001);
    await Promise.all([
      t.mutation(api.machineBackups.writeDownloadConfirmation, {
        sessionId: owner.sessionId,
        requestId,
        receivedBytes: 3,
      }),
      t.mutation(internal.machineBackups.cleanupExpiredBackupRequests, {}),
    ]);

    const row = await getRow(requestId);
    expect(['downloaded', 'expired']).toContain(row?.status);
    expect(await getStorageDoc(storageId)).toBeNull();
  });
});

describe('machineBackups cron idempotency', () => {
  test('running the cron twice on an expired row does not throw or double-delete', async () => {
    const start = 1_700_000_000_000;
    useTime(start);
    const owner = await registerOwner();
    const { requestId, storageId } = await prepareReady(owner);

    vi.setSystemTime(start + 3_600_001);
    await t.mutation(internal.machineBackups.cleanupExpiredBackupRequests, {});
    await t.mutation(internal.machineBackups.cleanupExpiredBackupRequests, {});

    expect((await getRow(requestId))?.status).toBe('expired');
    expect(await getStorageDoc(storageId)).toBeNull();
  });
});
