import { describe, it, expect } from 'vitest';
import { stripMarkdown, toPlatformMessage } from '../mapping.js';
import { Message as ChatMessage } from 'chat';

// ─── stripMarkdown ────────────────────────────────────────────────────────────

describe('stripMarkdown', () => {
  it('returns plain text unchanged', () => {
    expect(stripMarkdown('Hello world')).toBe('Hello world');
  });

  it('strips bold **text**', () => {
    expect(stripMarkdown('Hello **world**')).toBe('Hello world');
  });

  it('strips bold __text__', () => {
    expect(stripMarkdown('Hello __world__')).toBe('Hello world');
  });

  it('strips italic *text*', () => {
    expect(stripMarkdown('Hello *world*')).toBe('Hello world');
  });

  it('strips italic _text_', () => {
    expect(stripMarkdown('Hello _world_')).toBe('Hello world');
  });

  it('strips strikethrough ~~text~~', () => {
    expect(stripMarkdown('Hello ~~world~~')).toBe('Hello world');
  });

  it('strips inline code', () => {
    expect(stripMarkdown('Use `console.log`')).toBe('Use console.log');
  });

  it('strips code blocks', () => {
    expect(stripMarkdown('```\nconst x = 1;\n```')).toBe('const x = 1;');
  });

  it('strips links [text](url)', () => {
    expect(stripMarkdown('Click [here](https://example.com)')).toBe('Click here');
  });

  it('handles multiple formatting in one string', () => {
    expect(stripMarkdown('**Bold** and *italic* and `code`')).toBe(
      'Bold and italic and code',
    );
  });

  it('handles empty string', () => {
    expect(stripMarkdown('')).toBe('');
  });
});

// ─── toPlatformMessage ────────────────────────────────────────────────────────

describe('toPlatformMessage', () => {
  const dateSent = new Date('2026-01-15T12:00:00Z');

  function makeChatMessage(overrides: Partial<{
    id: string;
    text: string;
    userId: string;
    fullName: string;
    userName: string;
    dateSent: Date;
  }> = {}): ChatMessage {
    // Create a minimal ChatMessage-like object for testing.
    // The Chat SDK Message class accepts a MessageData object.
    return new ChatMessage({
      id: overrides.id ?? 'msg-1',
      text: overrides.text ?? 'Hello from Telegram',
      threadId: 'thread-abc',
      author: {
        userId: overrides.userId ?? 'user-42',
        fullName: overrides.fullName ?? 'Alice',
        userName: overrides.userName ?? 'alice',
        isBot: false,
        isMe: false,
      },
      metadata: {
        dateSent: overrides.dateSent ?? dateSent,
        edited: false,
      },
      formatted: { type: 'root', children: [] },
      raw: {},
      attachments: [],
    });
  }

  it('maps basic fields correctly', () => {
    const msg = makeChatMessage();
    const result = toPlatformMessage('thread-abc', msg, 'telegram');

    expect(result).toEqual({
      id: 'msg-1',
      text: 'Hello from Telegram',
      threadId: 'thread-abc',
      author: {
        id: 'user-42',
        name: 'Alice',
      },
      timestamp: '2026-01-15T12:00:00.000Z',
      platform: 'telegram',
    });
  });

  it('strips markdown from message text', () => {
    const msg = makeChatMessage({ text: 'Hello **world**' });
    const result = toPlatformMessage('t-1', msg, 'telegram');
    expect(result.text).toBe('Hello world');
  });

  it('uses fullName as author name', () => {
    const msg = makeChatMessage({ fullName: 'Bob Smith', userName: 'bobsmith' });
    const result = toPlatformMessage('t-1', msg, 'telegram');
    expect(result.author.name).toBe('Bob Smith');
  });

  it('sets the platform field from argument', () => {
    const msg = makeChatMessage();
    const result = toPlatformMessage('t-1', msg, 'slack');
    expect(result.platform).toBe('slack');
  });
});
