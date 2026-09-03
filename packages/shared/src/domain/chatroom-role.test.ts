import { describe, expect, test } from 'vitest';

import { isChatroomUserRole, normalizeChatroomRole } from './chatroom-role';

describe('chatroom-role', () => {
  test('normalizeChatroomRole lowercases and trims', () => {
    expect(normalizeChatroomRole(' Builder ')).toBe('builder');
  });

  test('isChatroomUserRole matches user case-insensitively', () => {
    expect(isChatroomUserRole('user')).toBe(true);
    expect(isChatroomUserRole('USER')).toBe(true);
    expect(isChatroomUserRole('builder')).toBe(false);
  });
});
