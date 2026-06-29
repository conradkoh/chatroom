import { describe, expect, it } from 'vitest';

import { filterSignalsAfterKey } from './assigned-tasks-core';
import type { AssignedTaskSignal } from './assigned-tasks-types';

function signal(revisionKey: string): AssignedTaskSignal {
  return {
    taskId: `task-${revisionKey}` as AssignedTaskSignal['taskId'],
    chatroomId: 'room' as AssignedTaskSignal['chatroomId'],
    role: 'builder',
    status: 'pending',
    signalType: 'task',
    revisionKey,
  };
}

describe('filterSignalsAfterKey', () => {
  it('returns signals strictly after the cursor in ascending order', () => {
    const slice = filterSignalsAfterKey([signal('003'), signal('001'), signal('002')], '001', 10);

    expect(slice.items.map((item) => item.revisionKey)).toEqual(['002', '003']);
    expect(slice.highKey).toBe('003');
    expect(slice.hasMore).toBe(false);
  });

  it('respects limit and sets hasMore', () => {
    const slice = filterSignalsAfterKey(
      [signal('001'), signal('002'), signal('003')],
      undefined,
      2
    );

    expect(slice.items).toHaveLength(2);
    expect(slice.hasMore).toBe(true);
    expect(slice.highKey).toBe('002');
  });
});
