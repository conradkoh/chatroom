import { describe, expect, test } from 'vitest';
import { isActiveParticipant, PARTICIPANT_EXITED_ACTION } from './participant';

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
