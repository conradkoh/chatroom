import { describe, expect, it } from 'vitest';

import { assignedTaskPresenceFeedDef } from './assigned-task-presence.js';

const TASK_ID = 'nh7dh7bj63fdns9zkyasjgnga58afx3s';

describe('assignedTaskPresenceFeedDef', () => {
  it('parses slim presence delta wire payloads', () => {
    const parsed = assignedTaskPresenceFeedDef.parseItem!({
      taskId: TASK_ID,
      role: 'builder',
      presenceKey: `000000000001500:${TASK_ID}:builder`,
    });

    expect(parsed.taskId).toBe(TASK_ID);
    expect(parsed.role).toBe('builder');
    expect(parsed.presenceKey).toBe(`000000000001500:${TASK_ID}:builder`);
    expect(parsed.presenceUpdatedAt).toBe(1500);
    expect(parsed.lastSeenAt).toBe(1500);
  });

  it('uses presenceKey as stream item key', () => {
    const presenceKey = `000000000001500:${TASK_ID}:builder`;
    const parsed = assignedTaskPresenceFeedDef.parseItem!({
      taskId: TASK_ID,
      role: 'builder',
      presenceKey,
    });
    expect(assignedTaskPresenceFeedDef.itemKey(parsed)).toBe(presenceKey);
  });
});
