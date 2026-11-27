/**
 * Machine backup service tests.
 *
 * The seam is `MachineBackupPorts`: a hand-written fake filesystem and fake Convex reports.
 * Internal functions are never mocked, so the test observes the service's decisions — filtering,
 * sort, cap, gates, stability, retries, dedupe — exactly as the daemon sees them.
 */

import type { Id } from '@workspace/backend/convex/_generated/dataModel.js';
import { BACKUP_MAX_BYTES } from '@workspace/shared/domain/machine-backup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createMachineBackupService,
  type BackupInventoryEntry,
  type DirFile,
  type FileStat,
  type InventoryReport,
  type MachineBackupPorts,
} from './machine-backup-service.js';

type BackupRequestId = Id<'chatroom_machineBackupRequests'>;

const REQUEST_ID = 'req-backup-1' as BackupRequestId;
const BACKUP_DIR = '/root/services/backend/.convex/user-backups';
const FIRST_FILE = 'backup-20260101-000000.zip';
const FAKE_SHA = 'ab'.repeat(32);

function file(name: string, overrides: Partial<DirFile> = {}): DirFile {
  return { name, isFile: true, isSymlink: false, size: 1234, mtimeMs: 1, ...overrides };
}

function stat(overrides: Partial<FileStat> = {}): FileStat {
  return { isFile: true, isSymlink: false, size: 1234, mtimeMs: 1, ...overrides };
}

function createPorts(overrides: Partial<MachineBackupPorts> = {}): MachineBackupPorts {
  return {
    resolveBackupDir: vi.fn(() => BACKUP_DIR),
    listDir: vi.fn(async () => []),
    statFile: vi.fn(async () => stat()),
    assertUploadUrl: vi.fn(),
    uploadFile: vi.fn(async () => ({ storageId: 's1', sha256: FAKE_SHA })),
    reportInventory: vi.fn(async () => ({ ok: true })),
    createUploadUrl: vi.fn(async () => ({
      ok: true as const,
      uploadUrl: 'https://a.convex.site/u',
    })),
    reportUploaded: vi.fn(async () => ({ ok: true })),
    reportFailed: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

/** Lets a background job run to its next await boundary; the jobs resolve in microtasks. */
async function settle(times = 16): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function lastInventoryReport(ports: MachineBackupPorts): InventoryReport {
  const calls = vi.mocked(ports.reportInventory).mock.calls;
  return calls[calls.length - 1]?.[0] as InventoryReport;
}

function lastBackups(ports: MachineBackupPorts): BackupInventoryEntry[] {
  const report = lastInventoryReport(ports);
  return report.status === 'completed' ? report.backups : [];
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('machine backup inventory', () => {
  it('reports no stack found when the local stack is absent', async () => {
    const ports = createPorts({ resolveBackupDir: vi.fn(() => null) });
    const service = createMachineBackupService(ports);

    expect(service.serveInventory({ requestId: REQUEST_ID })).toBe('started');
    await settle();

    expect(ports.reportInventory).toHaveBeenCalledOnce();
    const report = lastInventoryReport(ports);
    expect(report).toMatchObject({
      requestId: REQUEST_ID,
      status: 'completed',
      stackFound: false,
      backups: [],
      totalCount: 0,
      totalBytes: 0,
      truncated: false,
    });
    expect(report).not.toHaveProperty('inventoryDir');
  });

  it('lists only regular, non-symlink backup archives', async () => {
    const ports = createPorts({
      listDir: vi.fn(async () => [
        file(FIRST_FILE),
        file('backup-20260102-000000.zip', { isSymlink: true }),
        file('notes.zip'),
        file('backup-20260103-000000.zip', { isFile: false }),
      ]),
    });
    const service = createMachineBackupService(ports);

    service.serveInventory({ requestId: REQUEST_ID });
    await settle();

    expect(lastBackups(ports).map((entry) => entry.filename)).toEqual([FIRST_FILE]);
    expect(lastInventoryReport(ports)).toMatchObject({ totalCount: 1, truncated: false });
  });

  it('sorts newest first and caps the payload at 200 entries', async () => {
    const files = Array.from({ length: 201 }, (_, index) =>
      file(`backup-20260101-${String(index).padStart(6, '0')}.zip`, {
        size: 1,
        mtimeMs: index,
      })
    );
    const ports = createPorts({ listDir: vi.fn(async () => files) });
    const service = createMachineBackupService(ports);

    service.serveInventory({ requestId: REQUEST_ID });
    await settle();

    const backups = lastBackups(ports);
    expect(backups).toHaveLength(200);
    expect(backups[0]?.modifiedAt).toBe(200);
    expect(lastInventoryReport(ports)).toMatchObject({
      status: 'completed',
      totalCount: 201,
      totalBytes: 201,
      newestAt: 200,
      truncated: true,
    });
  });

  it('treats a missing directory as an empty inventory without creating it', async () => {
    const listDir = vi.fn(async () => {
      throw Object.assign(new Error('no dir'), { code: 'ENOENT' });
    });
    const ports = createPorts({ listDir });
    const service = createMachineBackupService(ports);

    service.serveInventory({ requestId: REQUEST_ID });
    await settle();

    expect(listDir).toHaveBeenCalledTimes(1);
    expect(lastInventoryReport(ports)).toMatchObject({
      status: 'completed',
      stackFound: true,
      backups: [],
      totalCount: 0,
      truncated: false,
    });
  });

  it('reports a read failure as a failed inventory', async () => {
    const ports = createPorts({
      listDir: vi.fn(async () => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      }),
    });
    const service = createMachineBackupService(ports);

    service.serveInventory({ requestId: REQUEST_ID });
    await settle();

    expect(ports.reportInventory).toHaveBeenCalledOnce();
    expect(lastInventoryReport(ports)).toMatchObject({
      status: 'failed',
      errorMessage: 'EACCES: permission denied',
    });
  });

  it('retries a failed inventory report and never sends a failure report', async () => {
    vi.useFakeTimers();
    const reportInventory = vi
      .fn<MachineBackupPorts['reportInventory']>()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({ ok: true });
    const ports = createPorts({ reportInventory });
    const service = createMachineBackupService(ports);

    service.serveInventory({ requestId: REQUEST_ID });
    await settle();
    expect(reportInventory).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    await settle();

    expect(reportInventory).toHaveBeenCalledTimes(2);
    expect(reportInventory.mock.calls[1]?.[0]).toMatchObject({ status: 'completed' });
  });
});

describe('machine backup upload', () => {
  it('fails a filename that the local stack never produces', async () => {
    const ports = createPorts();
    const service = createMachineBackupService(ports);

    service.serveUpload({ requestId: REQUEST_ID, filename: 'notes.zip' });
    await settle();

    expect(ports.reportFailed).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      errorCode: 'file_missing',
      errorMessage: 'Not a backup archive name',
    });
    expect(ports.createUploadUrl).not.toHaveBeenCalled();
  });

  it('refuses a symlink', async () => {
    const ports = createPorts({
      statFile: vi.fn(async () => stat({ isFile: false, isSymlink: true })),
    });
    const service = createMachineBackupService(ports);

    service.serveUpload({ requestId: REQUEST_ID, filename: FIRST_FILE });
    await settle();

    expect(ports.reportFailed).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'not_a_file' })
    );
    expect(ports.uploadFile).not.toHaveBeenCalled();
  });

  it('refuses a file above the size limit before minting a URL', async () => {
    const ports = createPorts({ statFile: vi.fn(async () => stat({ size: 268435457 })) });
    const service = createMachineBackupService(ports);

    service.serveUpload({ requestId: REQUEST_ID, filename: FIRST_FILE });
    await settle();

    expect(ports.reportFailed).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'too_large' })
    );
    expect(ports.createUploadUrl).not.toHaveBeenCalled();
  });

  it('accepts a file exactly at the size limit', async () => {
    const ports = createPorts({ statFile: vi.fn(async () => stat({ size: BACKUP_MAX_BYTES })) });
    const service = createMachineBackupService(ports);

    service.serveUpload({ requestId: REQUEST_ID, filename: FIRST_FILE });
    await settle();

    expect(ports.createUploadUrl).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      sizeBytes: BACKUP_MAX_BYTES,
    });
    expect(ports.reportFailed).not.toHaveBeenCalled();
  });

  it('reports a missing file', async () => {
    const ports = createPorts({
      statFile: vi.fn(async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }),
    });
    const service = createMachineBackupService(ports);

    service.serveUpload({ requestId: REQUEST_ID, filename: FIRST_FILE });
    await settle();

    expect(ports.reportFailed).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'file_missing' })
    );
  });

  it('uploads one archive and reports the stored copy as stable', async () => {
    const ports = createPorts();
    const service = createMachineBackupService(ports);

    service.serveUpload({ requestId: REQUEST_ID, filename: FIRST_FILE });
    await settle();

    expect(ports.assertUploadUrl).toHaveBeenCalledWith('https://a.convex.site/u');
    expect(ports.uploadFile).toHaveBeenCalledWith({
      path: `${BACKUP_DIR}/${FIRST_FILE}`,
      uploadUrl: 'https://a.convex.site/u',
      sizeBytes: 1234,
    });
    expect(ports.reportUploaded).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      storageId: 's1',
      sizeBytes: 1234,
      sha256: FAKE_SHA,
      stable: true,
    });
    expect(ports.reportFailed).not.toHaveBeenCalled();
  });

  it('reports the copy as unstable when the file changed during the upload', async () => {
    const ports = createPorts({
      statFile: vi
        .fn<MachineBackupPorts['statFile']>()
        .mockResolvedValueOnce(stat())
        .mockResolvedValueOnce(stat({ mtimeMs: 2 })),
    });
    const service = createMachineBackupService(ports);

    service.serveUpload({ requestId: REQUEST_ID, filename: FIRST_FILE });
    await settle();

    expect(ports.reportUploaded).toHaveBeenCalledWith(expect.objectContaining({ stable: false }));
  });

  it('reports the copy as unstable when the file disappeared during the upload', async () => {
    const ports = createPorts({
      statFile: vi
        .fn<MachineBackupPorts['statFile']>()
        .mockResolvedValueOnce(stat())
        .mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'ENOENT' })),
    });
    const service = createMachineBackupService(ports);

    service.serveUpload({ requestId: REQUEST_ID, filename: FIRST_FILE });
    await settle();

    expect(ports.reportUploaded).toHaveBeenCalledWith(expect.objectContaining({ stable: false }));
  });

  it('never sends bytes to a foreign upload origin and exhausts the attempts', async () => {
    const ports = createPorts({
      assertUploadUrl: vi.fn(() => {
        throw new Error('Upload URL origin https://evil.example does not match');
      }),
    });
    const service = createMachineBackupService(ports);

    service.serveUpload({ requestId: REQUEST_ID, filename: FIRST_FILE });
    await settle(40);

    expect(ports.uploadFile).not.toHaveBeenCalled();
    expect(ports.createUploadUrl).toHaveBeenCalledTimes(3);
    expect(ports.reportFailed).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'upload_failed' })
    );
  });

  it('retries a failed upload once and reports success', async () => {
    const ports = createPorts({
      uploadFile: vi
        .fn<MachineBackupPorts['uploadFile']>()
        .mockRejectedValueOnce(new Error('socket reset'))
        .mockResolvedValueOnce({ storageId: 's1', sha256: FAKE_SHA }),
    });
    const service = createMachineBackupService(ports);

    service.serveUpload({ requestId: REQUEST_ID, filename: FIRST_FILE });
    await settle(40);

    expect(ports.createUploadUrl).toHaveBeenCalledTimes(2);
    expect(ports.reportUploaded).toHaveBeenCalledOnce();
    expect(ports.reportFailed).not.toHaveBeenCalled();
  });

  it('stops without a report when the backend refuses the row', async () => {
    const ports = createPorts({
      createUploadUrl: vi.fn(async () => ({
        ok: false as const,
        reason: 'attempts_exhausted',
      })),
    });
    const service = createMachineBackupService(ports);

    service.serveUpload({ requestId: REQUEST_ID, filename: FIRST_FILE });
    await settle(40);

    expect(ports.uploadFile).not.toHaveBeenCalled();
    expect(ports.reportFailed).not.toHaveBeenCalled();
  });
});

describe('machine backup dedupe', () => {
  it('starts one job per request id while it is in flight', async () => {
    let release: (files: DirFile[]) => void = () => {};
    const pending = new Promise<DirFile[]>((resolve) => {
      release = resolve;
    });
    const listDir = vi.fn(() => pending);
    const ports = createPorts({ listDir });
    const service = createMachineBackupService(ports);

    expect(service.serveInventory({ requestId: REQUEST_ID })).toBe('started');
    expect(service.serveInventory({ requestId: REQUEST_ID })).toBe('duplicate');
    expect(listDir).toHaveBeenCalledTimes(1);

    release([]);
    await settle();
  });

  it('reports a synchronously throwing resolver as a failed inventory', async () => {
    const ports = createPorts({
      resolveBackupDir: vi.fn((): string | null => {
        throw new Error('stack probe exploded');
      }),
    });
    const service = createMachineBackupService(ports);

    expect(service.serveInventory({ requestId: REQUEST_ID })).toBe('started');
    await settle();

    expect(lastInventoryReport(ports)).toMatchObject({
      status: 'failed',
      errorMessage: 'stack probe exploded',
    });
  });
});
