import { describe, expect, it } from 'vitest';

import { sortChatroomsWithCurrentFirst } from './sortChatroomsWithCurrentFirst';

describe('sortChatroomsWithCurrentFirst', () => {
  const chatrooms = [
    { _id: 'a', name: 'Alpha' },
    { _id: 'b', name: 'Bravo' },
    { _id: 'c', name: 'Charlie' },
  ];

  it('returns the same array when no current chatroom is set', () => {
    expect(sortChatroomsWithCurrentFirst(chatrooms, null)).toEqual(chatrooms);
  });

  it('returns the same array when the current chatroom is already first', () => {
    expect(sortChatroomsWithCurrentFirst(chatrooms, 'a')).toEqual(chatrooms);
  });

  it('moves the current chatroom to the front without reordering the rest', () => {
    expect(sortChatroomsWithCurrentFirst(chatrooms, 'c')).toEqual([
      { _id: 'c', name: 'Charlie' },
      { _id: 'a', name: 'Alpha' },
      { _id: 'b', name: 'Bravo' },
    ]);
  });

  it('returns the original array when the current id is not found', () => {
    expect(sortChatroomsWithCurrentFirst(chatrooms, 'missing')).toEqual(chatrooms);
  });
});
