import { describe, expect, it } from 'vitest';

import {
  getChatStatusDescription,
  getChatStatusIndicatorClasses,
  getChatStatusLabel,
} from './chatStatusDisplay';

describe('chatStatusDisplay', () => {
  it.each([
    ['working', 'bg-chatroom-status-info', 'Working', 'Agents are working on tasks'],
    ['active', 'bg-chatroom-status-success', 'Waiting', 'Agents are waiting for tasks'],
    [
      'transitioning',
      'bg-chatroom-status-warning',
      'Transitioning',
      'Agents are online but not yet waiting for tasks',
    ],
    ['idle', 'bg-chatroom-text-muted', 'Idle', 'No agents online'],
    ['completed', 'bg-chatroom-text-muted', 'Completed', 'Archived'],
  ] as const)(
    'maps %s status to consistent indicator, label, and description',
    (status, colorToken, label, description) => {
      expect(getChatStatusIndicatorClasses(status)).toContain(colorToken);
      expect(getChatStatusLabel(status)).toBe(label);
      expect(getChatStatusDescription(status)).toBe(description);
    }
  );
});
