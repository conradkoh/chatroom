import { describe, it, expect } from 'vitest';
import { parseTelegramUpdate, type TelegramUpdate } from './telegramBotInternal';

describe('parseTelegramUpdate', () => {
  it('returns null for updates without a message', () => {
    const update: TelegramUpdate = { update_id: 1 };
    expect(parseTelegramUpdate(update)).toBeNull();
  });

  it('returns null for messages without text', () => {
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 123, type: 'private' },
        date: 1700000000,
      },
    };
    expect(parseTelegramUpdate(update)).toBeNull();
  });

  it('parses a basic text message correctly', () => {
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 42,
        from: {
          id: 100,
          is_bot: false,
          first_name: 'Alice',
          last_name: 'Smith',
          username: 'alice',
        },
        chat: {
          id: 456,
          type: 'private',
          first_name: 'Alice',
        },
        date: 1700000000,
        text: 'Hello bot!',
      },
    };

    const result = parseTelegramUpdate(update);
    expect(result).toEqual({
      messageId: 42,
      chatId: '456',
      chatType: 'private',
      chatTitle: 'Alice',
      senderName: 'Alice Smith',
      senderUsername: 'alice',
      senderId: '100',
      text: 'Hello bot!',
      date: 1700000000,
    });
  });

  it('handles messages without sender info', () => {
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 789, type: 'group', title: 'My Group' },
        date: 1700000000,
        text: 'Group message',
      },
    };

    const result = parseTelegramUpdate(update);
    expect(result).not.toBeNull();
    expect(result!.senderName).toBe('Unknown');
    expect(result!.senderUsername).toBeUndefined();
    expect(result!.senderId).toBeUndefined();
    expect(result!.chatTitle).toBe('My Group');
  });

  it('handles sender with only first name', () => {
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        from: {
          id: 100,
          is_bot: false,
          first_name: 'Bob',
        },
        chat: { id: 123, type: 'private', first_name: 'Bob' },
        date: 1700000000,
        text: 'Hi',
      },
    };

    const result = parseTelegramUpdate(update);
    expect(result!.senderName).toBe('Bob');
    expect(result!.senderUsername).toBeUndefined();
  });

  it('uses chat.first_name as fallback for chatTitle', () => {
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 123, type: 'private', first_name: 'Charlie' },
        date: 1700000000,
        text: 'Test',
      },
    };

    const result = parseTelegramUpdate(update);
    expect(result!.chatTitle).toBe('Charlie');
  });

  it('falls back to Unknown for chatTitle', () => {
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        chat: { id: 123, type: 'channel' },
        date: 1700000000,
        text: 'Test',
      },
    };

    const result = parseTelegramUpdate(update);
    expect(result!.chatTitle).toBe('Unknown');
  });
});
