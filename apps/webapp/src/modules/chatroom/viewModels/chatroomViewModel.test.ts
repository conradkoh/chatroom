import { describe, expect, it } from 'vitest';

import { getChatroomDisplayName, isChatroomCompleted } from './chatroomViewModel';
import type { ChatroomWithStatus } from '../context/ChatroomListingContext';

type Listing = Pick<ChatroomWithStatus, 'status'>;

describe('isChatroomCompleted', () => {
  it('is completed when the listing says completed, whatever the live state', () => {
    const listing: Listing = { status: 'completed' };

    expect(isChatroomCompleted(listing, undefined)).toBe(true);
    expect(isChatroomCompleted(listing, 'active')).toBe(true);
    expect(isChatroomCompleted(listing, 'attention')).toBe(true);
    expect(isChatroomCompleted(listing, 'offline')).toBe(true);
    expect(isChatroomCompleted(listing, 'completed')).toBe(true);
  });

  it('is completed when the live state says completed, even if the listing does not', () => {
    const listing: Listing = { status: 'active' };

    expect(isChatroomCompleted(listing, 'completed')).toBe(true);
  });

  it('is not completed while neither the listing nor the live state says so', () => {
    const listing: Listing = { status: 'active' };

    expect(isChatroomCompleted(listing, undefined)).toBe(false);
    expect(isChatroomCompleted(listing, 'active')).toBe(false);
    expect(isChatroomCompleted(listing, 'attention')).toBe(false);
    expect(isChatroomCompleted(listing, 'offline')).toBe(false);
  });
});

describe('getChatroomDisplayName', () => {
  it('uses the custom name, then the team name, then Chatroom', () => {
    expect(getChatroomDisplayName({ name: 'Alpha', teamName: 'Duo' })).toBe('Alpha');
    expect(getChatroomDisplayName({ name: '', teamName: 'Duo' })).toBe('Duo');
    expect(getChatroomDisplayName({ name: '', teamName: '' })).toBe('Chatroom');
  });
});
