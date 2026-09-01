/** Verifies observation TTL expiry schedules a workspace-list inbox nudge without daemon polling. */
import { afterEach, describe, expect, test, vi } from 'vitest';

import { OBSERVATION_TTL_MS } from '../../config/reliability';
import { api } from '../../convex/_generated/api';
import { t } from '../../test.setup';
import {
  createDuoTeamChatroom,
  createTestSession,
  registerMachineWithDaemon,
} from '../helpers/integration';
import { getInboxCommandsForMachine } from '../helpers/machine-command-inbox';

describe('observation expiry nudge', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('fires workspaceListChanged after TTL when heartbeats stop', async () => {
    vi.useFakeTimers();
    const { sessionId } = await createTestSession('obs-expiry-nudge');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'obs-expiry-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/tmp/obs-expiry',
      hostname: 'test',
      registeredBy: 'test',
    });

    // Initial observation — clears register nudge count baseline.
    await t.mutation(api.chatrooms.recordChatroomObservation, {
      sessionId,
      chatroomId,
    });
    const countAfterObserve = (
      await getInboxCommandsForMachine(machineId, 'daemon.workspaceListChanged')
    ).length;

    // Advance past TTL — scheduled internal mutation should fire.
    await vi.advanceTimersByTimeAsync(OBSERVATION_TTL_MS + 1_000);
    await t.finishInProgressScheduledFunctions();

    const countAfterExpiry = (
      await getInboxCommandsForMachine(machineId, 'daemon.workspaceListChanged')
    ).length;
    expect(countAfterExpiry).toBeGreaterThan(countAfterObserve);
  });

  test('does not fire when heartbeat reschedules before TTL', async () => {
    vi.useFakeTimers();
    const { sessionId } = await createTestSession('obs-expiry-reschedule');
    const chatroomId = await createDuoTeamChatroom(sessionId);
    const machineId = 'obs-expiry-reschedule-machine';
    await registerMachineWithDaemon(sessionId, machineId);
    await t.mutation(api.workspaces.registerWorkspace, {
      sessionId,
      chatroomId,
      machineId,
      workingDir: '/tmp/obs-expiry-reschedule',
      hostname: 'test',
      registeredBy: 'test',
    });

    await t.mutation(api.chatrooms.recordChatroomObservation, { sessionId, chatroomId });
    const countAfterObserve = (
      await getInboxCommandsForMachine(machineId, 'daemon.workspaceListChanged')
    ).length;

    // Advance halfway, send another observation (reschedules expiry).
    await vi.advanceTimersByTimeAsync(OBSERVATION_TTL_MS / 2);
    await t.mutation(api.chatrooms.recordChatroomObservation, { sessionId, chatroomId });

    // Advance to original expiry — stale scheduled function should no-op.
    await vi.advanceTimersByTimeAsync(OBSERVATION_TTL_MS / 2 + 1_000);
    await t.finishInProgressScheduledFunctions();

    const countMid = (await getInboxCommandsForMachine(machineId, 'daemon.workspaceListChanged'))
      .length;
    expect(countMid).toBe(countAfterObserve);

    // Advance to new expiry — should fire.
    await vi.advanceTimersByTimeAsync(OBSERVATION_TTL_MS);
    await t.finishInProgressScheduledFunctions();

    const countFinal = (await getInboxCommandsForMachine(machineId, 'daemon.workspaceListChanged'))
      .length;
    expect(countFinal).toBeGreaterThan(countAfterObserve);
  });
});
