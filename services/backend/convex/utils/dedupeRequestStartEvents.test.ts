import { describe, expect, it } from 'vitest';

import { dedupeRequestStartEvents } from './dedupeRequestStartEvents';

describe('dedupeRequestStartEvents', () => {
  it('keeps only the latest event per chatroom+role', () => {
    const events = [
      { chatroomId: 'room-1', role: 'builder', timestamp: 100, id: 'a' },
      { chatroomId: 'room-1', role: 'builder', timestamp: 200, id: 'b' },
      { chatroomId: 'room-1', role: 'reviewer', timestamp: 150, id: 'c' },
    ];

    const result = dedupeRequestStartEvents(events);

    expect(result).toHaveLength(2);
    expect(result.find((e) => e.role === 'builder')?.id).toBe('b');
    expect(result.find((e) => e.role === 'reviewer')?.id).toBe('c');
  });

  it('returns empty array for empty input', () => {
    expect(dedupeRequestStartEvents([])).toEqual([]);
  });
});
