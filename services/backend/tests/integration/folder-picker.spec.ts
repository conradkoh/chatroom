/**
 * Folder Picker — Integration Tests
 *
 * Covers requestFolderPicker, getFolderPickerRequest, reportFolderPickerResult,
 * and end-to-end delivery of daemon.pickFolder via getCommandEvents.
 */

import { describe, expect, test } from 'vitest';

import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import { createTestSession, registerMachineWithDaemon } from '../helpers/integration';

const SELECTED_PATH = '/tmp/workspace-picker';

async function setupMachine(sessionKey: string, machineId: string) {
  const { sessionId } = await createTestSession(sessionKey);
  await registerMachineWithDaemon(sessionId, machineId);
  return { sessionId, machineId };
}

describe('folder picker requests', () => {
  test('requestFolderPicker creates pending request and daemon.pickFolder event', async () => {
    const { sessionId, machineId } = await setupMachine('test-fp-create', 'machine-fp-create');

    const { requestId } = await t.mutation(api.machines.requestFolderPicker, {
      sessionId,
      machineId,
    });

    const request = await t.query(api.machines.getFolderPickerRequest, {
      sessionId,
      requestId,
    });
    expect(request).not.toBeNull();
    expect(request!.status).toBe('pending');
    expect(request!.machineId).toBe(machineId);

    const events = await t.run(async (ctx) =>
      ctx.db
        .query('chatroom_eventStream')
        .withIndex('by_machineId_type', (q) =>
          q.eq('machineId', machineId).eq('type', 'daemon.pickFolder')
        )
        .collect()
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('daemon.pickFolder');
    if (events[0].type === 'daemon.pickFolder') {
      expect(events[0].requestId).toBe(requestId);
    }
  });

  test('getFolderPickerRequest returns null for another user', async () => {
    const { sessionId, machineId } = await setupMachine(
      'test-fp-auth-owner',
      'machine-fp-auth-owner'
    );
    const { sessionId: otherSessionId } = await createTestSession('test-fp-auth-other');

    const { requestId } = await t.mutation(api.machines.requestFolderPicker, {
      sessionId,
      machineId,
    });

    const request = await t.query(api.machines.getFolderPickerRequest, {
      sessionId: otherSessionId,
      requestId,
    });
    expect(request).toBeNull();
  });

  test('reportFolderPickerResult completes request with selected path', async () => {
    const { sessionId, machineId } = await setupMachine('test-fp-complete', 'machine-fp-complete');

    const { requestId } = await t.mutation(api.machines.requestFolderPicker, {
      sessionId,
      machineId,
    });

    const result = await t.mutation(api.machines.reportFolderPickerResult, {
      sessionId,
      requestId,
      machineId,
      status: 'completed',
      selectedPath: SELECTED_PATH,
    });
    expect(result).toEqual({ ok: true });

    const request = await t.query(api.machines.getFolderPickerRequest, {
      sessionId,
      requestId,
    });
    expect(request!.status).toBe('completed');
    expect(request!.selectedPath).toBe(SELECTED_PATH);
    expect(request!.completedAt).toBeDefined();
  });

  test('reportFolderPickerResult is idempotent on duplicate report', async () => {
    const { sessionId, machineId } = await setupMachine('test-fp-dup', 'machine-fp-dup');

    const { requestId } = await t.mutation(api.machines.requestFolderPicker, {
      sessionId,
      machineId,
    });

    await t.mutation(api.machines.reportFolderPickerResult, {
      sessionId,
      requestId,
      machineId,
      status: 'completed',
      selectedPath: SELECTED_PATH,
    });

    const duplicate = await t.mutation(api.machines.reportFolderPickerResult, {
      sessionId,
      requestId,
      machineId,
      status: 'completed',
      selectedPath: '/tmp/other-path',
    });
    expect(duplicate).toEqual({ ok: true, duplicate: true });

    const request = await t.query(api.machines.getFolderPickerRequest, {
      sessionId,
      requestId,
    });
    expect(request!.status).toBe('completed');
    expect(request!.selectedPath).toBe(SELECTED_PATH);
  });

  test('end-to-end: request → getCommandEvents → report → poll', async () => {
    const { sessionId, machineId } = await setupMachine('test-fp-e2e', 'machine-fp-e2e');

    const { requestId } = await t.mutation(api.machines.requestFolderPicker, {
      sessionId,
      machineId,
    });

    const commandEvents = await t.query(api.machines.getCommandEvents, {
      sessionId,
      machineId,
    });
    const pickFolderEvent = commandEvents.events.find((e) => e.type === 'daemon.pickFolder');
    expect(pickFolderEvent).toBeDefined();
    if (pickFolderEvent?.type === 'daemon.pickFolder') {
      expect(pickFolderEvent.requestId).toBe(requestId);
    }

    await t.mutation(api.machines.reportFolderPickerResult, {
      sessionId,
      requestId,
      machineId,
      status: 'completed',
      selectedPath: SELECTED_PATH,
    });

    const request = await t.query(api.machines.getFolderPickerRequest, {
      sessionId,
      requestId,
    });
    expect(request!.status).toBe('completed');
    expect(request!.selectedPath).toBe(SELECTED_PATH);
  });

  test('reportFolderPickerResult records cancelled status', async () => {
    const { sessionId, machineId } = await setupMachine('test-fp-cancel', 'machine-fp-cancel');

    const { requestId } = await t.mutation(api.machines.requestFolderPicker, {
      sessionId,
      machineId,
    });

    await t.mutation(api.machines.reportFolderPickerResult, {
      sessionId,
      requestId,
      machineId,
      status: 'cancelled',
      errorMessage: 'Cancelled',
    });

    const request = await t.query(api.machines.getFolderPickerRequest, {
      sessionId,
      requestId,
    });
    expect(request!.status).toBe('cancelled');
    expect(request!.errorMessage).toBe('Cancelled');
    expect(request!.selectedPath).toBeUndefined();
  });
});
