import { describe, expect, it } from 'vitest';

import {
  getChatroomActivityDescription,
  getChatroomActivityIndicatorClasses,
} from './activityStatusDisplay';

describe('activityStatusDisplay', () => {
  it.each([
    ['working', 'bg-chatroom-status-info', 'Agents are working on tasks'],
    ['active', 'bg-chatroom-status-success', 'Agents are waiting for tasks'],
    [
      'transitioning',
      'bg-chatroom-status-warning',
      'Agents are online but not yet waiting for tasks',
    ],
    ['idle', 'bg-chatroom-text-muted', 'No agents online'],
    ['completed', 'bg-chatroom-text-muted', 'Archived'],
  ] as const)(
    'maps %s status to consistent indicator and description',
    (status, colorToken, description) => {
      expect(getChatroomActivityIndicatorClasses(status)).toContain(colorToken);
      expect(getChatroomActivityDescription(status)).toBe(description);
    }
  );
});
