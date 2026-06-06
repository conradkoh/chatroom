import { describe, expect, test } from 'vitest';

import {
  isActiveParticipant,
  PARTICIPANT_EXITED_ACTION,
  toParticipantPresence,
} from './participant';

describe('participant entity', () => {
  test('PARTICIPANT_EXITED_ACTION equals "exited"', () => {
    expect(PARTICIPANT_EXITED_ACTION).toBe('exited');
  });

  test('isActiveParticipant returns true for lastSeenAction: "get-next-task:started"', () => {
    expect(isActiveParticipant({ lastSeenAction: 'get-next-task:started' })).toBe(true);
  });

  test('isActiveParticipant returns true for lastSeenAction: undefined', () => {
    expect(isActiveParticipant({ lastSeenAction: undefined })).toBe(true);
  });

  test('isActiveParticipant returns true for lastSeenAction: null', () => {
    expect(isActiveParticipant({ lastSeenAction: null })).toBe(true);
  });

  test('isActiveParticipant returns false for lastSeenAction: "exited"', () => {
    expect(isActiveParticipant({ lastSeenAction: 'exited' })).toBe(false);
  });
});

describe('toParticipantPresence', () => {
  test('normalizes missing optional columns to explicit null (not undefined or a default)', () => {
    const row = toParticipantPresence('room_1', { role: 'solo' });

    expect(row).toEqual({
      chatroomId: 'room_1',
      role: 'solo',
      lastSeenAt: null,
      lastSeenAction: null,
      lastStatus: null,
      lastDesiredState: null,
    });
  });

  test('passes through present values unchanged', () => {
    const row = toParticipantPresence('room_2', {
      role: 'reviewer',
      lastSeenAt: 1700000000000,
      lastSeenAction: 'get-next-task:started',
      lastStatus: 'task.inProgress',
      lastDesiredState: 'running',
    });

    expect(row).toEqual({
      chatroomId: 'room_2',
      role: 'reviewer',
      lastSeenAt: 1700000000000,
      lastSeenAction: 'get-next-task:started',
      lastStatus: 'task.inProgress',
      lastDesiredState: 'running',
    });
  });

  test('coerces explicit null inputs to null (idempotent)', () => {
    const row = toParticipantPresence('room_3', {
      role: 'solo',
      lastSeenAt: null,
      lastSeenAction: null,
      lastStatus: null,
      lastDesiredState: null,
    });

    expect(row.lastSeenAt).toBeNull();
    expect(row.lastStatus).toBeNull();
  });
});
