import { describe, expect, test } from 'vitest';

import {
  markRestartOrchestratorInFlight,
  clearRestartOrchestratorInFlight,
  isRestartOrchestratorInFlight,
  filterSnapshotsExcludingRestartInFlight,
  _resetRestartOrchestratorInFlightForTests,
} from './restart-orchestrator-in-flight.js';

describe('restart-orchestrator-in-flight', () => {
  test('mark sets in-flight for role', () => {
    _resetRestartOrchestratorInFlightForTests();
    markRestartOrchestratorInFlight('room_1', 'builder', 'corr-1');
    expect(isRestartOrchestratorInFlight('room_1', 'builder')).toBe(true);
  });

  test('clear removes in-flight for role', () => {
    _resetRestartOrchestratorInFlightForTests();
    markRestartOrchestratorInFlight('room_1', 'builder', 'corr-1');
    clearRestartOrchestratorInFlight('room_1', 'builder', 'corr-1');
    expect(isRestartOrchestratorInFlight('room_1', 'builder')).toBe(false);
  });

  test('clear with wrong correlationId does not clear', () => {
    _resetRestartOrchestratorInFlightForTests();
    markRestartOrchestratorInFlight('room_1', 'builder', 'corr-1');
    clearRestartOrchestratorInFlight('room_1', 'builder', 'wrong-corr');
    expect(isRestartOrchestratorInFlight('room_1', 'builder')).toBe(true);
  });

  test('clear without correlationId always clears', () => {
    _resetRestartOrchestratorInFlightForTests();
    markRestartOrchestratorInFlight('room_1', 'builder', 'corr-1');
    clearRestartOrchestratorInFlight('room_1', 'builder');
    expect(isRestartOrchestratorInFlight('room_1', 'builder')).toBe(false);
  });

  test('is case-insensitive for role', () => {
    _resetRestartOrchestratorInFlightForTests();
    markRestartOrchestratorInFlight('room_1', 'Builder', 'corr-1');
    expect(isRestartOrchestratorInFlight('room_1', 'builder')).toBe(true);
    expect(isRestartOrchestratorInFlight('room_1', 'BUILDER')).toBe(true);
  });

  test('different role is not in-flight', () => {
    _resetRestartOrchestratorInFlightForTests();
    markRestartOrchestratorInFlight('room_1', 'builder', 'corr-1');
    expect(isRestartOrchestratorInFlight('room_1', 'planner')).toBe(false);
  });

  test('filterSnapshotsExcludingRestartInFlight excludes in-flight roles', () => {
    _resetRestartOrchestratorInFlightForTests();
    markRestartOrchestratorInFlight('room_1', 'builder', 'corr-1');

    type TestSnapshot = {
      chatroomId: string;
      agentConfig: { role: string };
      taskId: string;
    };

    const snapshots: TestSnapshot[] = [
      { chatroomId: 'room_1', agentConfig: { role: 'builder' }, taskId: 't1' },
      { chatroomId: 'room_1', agentConfig: { role: 'planner' }, taskId: 't2' },
    ];

    const filtered = filterSnapshotsExcludingRestartInFlight(snapshots);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].taskId).toBe('t2');
  });
});
