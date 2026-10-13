/**
 * Folder Picker — Integration Tests
 *
 * Covers folderPickerRequests.request, get and reportResult, the deprecated
 * machines.reportFolderPickerResult delegate, and end-to-end delivery of daemon.pickFolder via the
 * machine command inbox.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';
import { getInboxCommandsForMachine } from '../helpers/machine-command-inbox';

const SELECTED_PATH = '/tmp/workspace-picker';

async function setupMachine(sessionKey: string, machineId: string) {
  const { sessionId } = await createTestSession(sessionKey);
  await registerMachineWithDaemon(sessionId, machineId);
  return { sessionId, machineId };
}

describe('folder picker requests', () => {
  test('request creates a pending request and a daemon.pickFolder event', async () => {
    const { sessionId, machineId } = await setupMachine('test-fp-create', 'machine-fp-create');

    const { requestId } = await t.mutation(api.folderPickerRequests.request, {
      sessionId,
      machineId,
    });

    const request = await t.query(api.folderPickerRequests.get, {
      sessionId,
      requestId,
    });
    expect(request).not.toBeNull();
    expect(request!.status).toBe('pending');
    expect(request!.machineId).toBe(machineId);

    const inbox = await getInboxCommandsForMachine(machineId, 'daemon.pickFolder');
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.command.type).toBe('daemon.pickFolder');
    if (inbox[0]!.command.type === 'daemon.pickFolder') {
      expect(inbox[0]!.command.requestId).toBe(requestId);
    }
  });

  test('get returns null for another user', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-fp-auth-owner',
      'machine-fp-auth-owner'
    );
    const { sessionId: otherSessionId } = await createTestSession('test-fp-auth-other');

    const { requestId } = await t.mutation(api.folderPickerRequests.request, {
      sessionId,
      machineId,
    });

    const request = await t.query(api.folderPickerRequests.get, {
      sessionId: otherSessionId,
      requestId,
    });
    expect(request).toBeNull();
  });

  test('reportResult completes request with selected path', async () => {
    const { sessionId, machineId } = await setupMachine('test-fp-complete', 'machine-fp-complete');

    const { requestId } = await t.mutation(api.folderPickerRequests.request, {
      sessionId,
      machineId,
    });

    const result = await t.mutation(api.folderPickerRequests.reportResult, {
      sessionId,
      requestId,
      machineId,
      status: 'completed',
      selectedPath: SELECTED_PATH,
    });
    expect(result).toEqual({ ok: true });

    const request = await t.query(api.folderPickerRequests.get, {
      sessionId,
      requestId,
    });
    expect(request!.status).toBe('completed');
    expect(request!.selectedPath).toBe(SELECTED_PATH);
    expect(request!.completedAt).toBeDefined();
  });

  test('reportResult is idempotent on duplicate report', async () => {
    const { sessionId, machineId } = await setupMachine('test-fp-dup', 'machine-fp-dup');

    const { requestId } = await t.mutation(api.folderPickerRequests.request, {
      sessionId,
      machineId,
    });

    await t.mutation(api.folderPickerRequests.reportResult, {
      sessionId,
      requestId,
      machineId,
      status: 'completed',
      selectedPath: SELECTED_PATH,
    });

    const duplicate = await t.mutation(api.folderPickerRequests.reportResult, {
      sessionId,
      requestId,
      machineId,
      status: 'completed',
      selectedPath: '/tmp/other-path',
    });
    expect(duplicate).toEqual({ ok: true, duplicate: true });

    const request = await t.query(api.folderPickerRequests.get, {
      sessionId,
      requestId,
    });
    expect(request!.status).toBe('completed');
    expect(request!.selectedPath).toBe(SELECTED_PATH);
  });

  test('end-to-end: request → inbox → report → poll', async () => {
    const { sessionId, machineId } = await setupMachine('test-fp-e2e', 'machine-fp-e2e');

    const { requestId } = await t.mutation(api.folderPickerRequests.request, {
      sessionId,
      machineId,
    });

    const inbox = await getInboxCommandsForMachine(machineId, 'daemon.pickFolder');
    expect(inbox).toHaveLength(1);
    const pickFolderEvent = inbox[0]!.command;
    expect(pickFolderEvent.type).toBe('daemon.pickFolder');
    if (pickFolderEvent.type === 'daemon.pickFolder') {
      expect(pickFolderEvent.requestId).toBe(requestId);
    }

    await t.mutation(api.folderPickerRequests.reportResult, {
      sessionId,
      requestId,
      machineId,
      status: 'completed',
      selectedPath: SELECTED_PATH,
    });

    const request = await t.query(api.folderPickerRequests.get, {
      sessionId,
      requestId,
    });
    expect(request!.status).toBe('completed');
    expect(request!.selectedPath).toBe(SELECTED_PATH);
  });

  test('reportResult records cancelled status', async () => {
    const { sessionId, machineId } = await setupMachine('test-fp-cancel', 'machine-fp-cancel');

    const { requestId } = await t.mutation(api.folderPickerRequests.request, {
      sessionId,
      machineId,
    });

    await t.mutation(api.folderPickerRequests.reportResult, {
      sessionId,
      requestId,
      machineId,
      status: 'cancelled',
      errorMessage: 'Cancelled',
    });

    const request = await t.query(api.folderPickerRequests.get, {
      sessionId,
      requestId,
    });
    expect(request!.status).toBe('cancelled');
    expect(request!.errorMessage).toBe('Cancelled');
    expect(request!.selectedPath).toBeUndefined();
  });
  test('the deprecated machines delegate stores and returns the same as reportResult', async () => {
    const { sessionId, machineId } = await setupMachine('test-fp-delegate', 'machine-fp-delegate');

    const { requestId: viaDelegate } = await t.mutation(api.folderPickerRequests.request, {
      sessionId,
      machineId,
    });
    const { requestId: viaReportResult } = await t.mutation(api.folderPickerRequests.request, {
      sessionId,
      machineId,
    });

    const delegateResult = await t.mutation(api.machines.reportFolderPickerResult, {
      sessionId,
      requestId: viaDelegate,
      machineId,
      status: 'completed',
      selectedPath: SELECTED_PATH,
    });
    const directResult = await t.mutation(api.folderPickerRequests.reportResult, {
      sessionId,
      requestId: viaReportResult,
      machineId,
      status: 'completed',
      selectedPath: SELECTED_PATH,
    });
    expect(delegateResult).toEqual(directResult);

    const delegateRow = await t.query(api.folderPickerRequests.get, {
      sessionId,
      requestId: viaDelegate,
    });
    const directRow = await t.query(api.folderPickerRequests.get, {
      sessionId,
      requestId: viaReportResult,
    });
    expect(delegateRow!.status).toBe(directRow!.status);
    expect(delegateRow!.selectedPath).toBe(directRow!.selectedPath);
    expect(delegateRow!.machineId).toBe(directRow!.machineId);

    const delegateDuplicate = await t.mutation(api.machines.reportFolderPickerResult, {
      sessionId,
      requestId: viaDelegate,
      machineId,
      status: 'completed',
      selectedPath: '/tmp/other-path',
    });
    expect(delegateDuplicate).toEqual({ ok: true, duplicate: true });
  });

  test('reportResult rejects a result for a request on another machine of the caller', async () => {
    const { sessionId, machineId } = await setupMachine('test-fp-owner-a', 'machine-fp-owner-a');
    await registerMachineWithDaemon(sessionId, 'machine-fp-owner-b');

    const { requestId } = await t.mutation(api.folderPickerRequests.request, {
      sessionId,
      machineId,
    });

    await expect(
      t.mutation(api.folderPickerRequests.reportResult, {
        sessionId,
        requestId,
        machineId: 'machine-fp-owner-b',
        status: 'completed',
        selectedPath: SELECTED_PATH,
      })
    ).rejects.toMatchObject({
      data: {
        code: 'NOT_AUTHORIZED_MACHINE',
        message: 'Folder picker request does not belong to this machine',
      },
    });
  });
});
