/**
 * Machine backup bridge tests.
 *
 * Argument mapping only: a fake session backend and a mocked `api` observe exactly what the
 * service ports send. The Convex validators themselves are checked by typecheck.
 */

import type { Id } from '@workspace/backend/convex/_generated/dataModel.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DaemonSessionServiceShape } from '../daemon-services.js';
import { createMachineBackupPorts } from './machine-backup-bridge.js';

vi.mock('../../../api.js', () => ({
  api: {
    machineBackups: {
      reportInventory: 'mock-machineBackups-reportInventory',
      createUploadUrl: 'mock-machineBackups-createUploadUrl',
      reportUploaded: 'mock-machineBackups-reportUploaded',
      reportFailed: 'mock-machineBackups-reportFailed',
    },
  },
}));

type BackupRequestId = Id<'chatroom_machineBackupRequests'>;

const REQUEST_ID = 'req-backup-1' as BackupRequestId;

function createSession(): {
  session: DaemonSessionServiceShape;
  mutation: ReturnType<typeof vi.fn>;
} {
  const mutation = vi.fn().mockResolvedValue({ ok: true });
  const session = {
    sessionId: 'session-1',
    machineId: 'machine-1',
    convexUrl: 'https://a.convex.cloud',
    backend: { query: vi.fn(), mutation },
  } as unknown as DaemonSessionServiceShape;
  return { session, mutation };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createMachineBackupPorts', () => {
  it('sends session identity plus the inventory report', async () => {
    const { session, mutation } = createSession();
    const ports = createMachineBackupPorts(session);

    await ports.reportInventory({
      requestId: REQUEST_ID,
      status: 'failed',
      errorMessage: 'x',
    });

    expect(mutation).toHaveBeenCalledWith('mock-machineBackups-reportInventory', {
      sessionId: 'session-1',
      machineId: 'machine-1',
      requestId: REQUEST_ID,
      status: 'failed',
      errorMessage: 'x',
    });
  });

  it('sends the size request and returns the backend decision', async () => {
    const { session, mutation } = createSession();
    mutation.mockResolvedValue({ ok: true, uploadUrl: 'https://a.convex.site/u' });
    const ports = createMachineBackupPorts(session);

    await expect(
      ports.createUploadUrl({ requestId: REQUEST_ID, sizeBytes: 1234 })
    ).resolves.toEqual({ ok: true, uploadUrl: 'https://a.convex.site/u' });
    expect(mutation).toHaveBeenCalledWith('mock-machineBackups-createUploadUrl', {
      sessionId: 'session-1',
      machineId: 'machine-1',
      requestId: REQUEST_ID,
      sizeBytes: 1234,
    });
  });

  it('passes the storage id through unchanged', async () => {
    const { session, mutation } = createSession();
    const ports = createMachineBackupPorts(session);

    await ports.reportUploaded({
      requestId: REQUEST_ID,
      storageId: 'storage-1',
      sizeBytes: 1234,
      sha256: 'ab'.repeat(32),
      stable: true,
    });

    expect(mutation).toHaveBeenCalledWith('mock-machineBackups-reportUploaded', {
      sessionId: 'session-1',
      machineId: 'machine-1',
      requestId: REQUEST_ID,
      storageId: 'storage-1',
      sizeBytes: 1234,
      sha256: 'ab'.repeat(32),
      stable: true,
    });
  });

  it('accepts the paired Convex site origin and rejects a foreign origin', () => {
    const { session } = createSession();
    const ports = createMachineBackupPorts(session);

    expect(() => ports.assertUploadUrl('https://a.convex.site/u')).not.toThrow();
    expect(() => ports.assertUploadUrl('https://evil.example/u')).toThrow(
      /does not match the configured backend/
    );
  });
});
