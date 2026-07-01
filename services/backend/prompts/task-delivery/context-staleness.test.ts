import { describe, expect, test } from 'vitest';

import { appendTaskDeliveryContextSection } from './context-staleness';

const BASE = {
  chatroomId: 'room-id',
  role: 'planner',
  cliEnvPrefix: 'CHATROOM_CONVEX_URL=http://127.0.0.1:3210 ',
  isEntryPoint: true,
  currentContext: null,
  originMessage: null,
  followUpCountSinceOrigin: 0,
  originMessageCreatedAt: null,
};

describe('appendTaskDeliveryContextSection', () => {
  test('warns when explicit context is >= 24h old and includes update hint for entry point', () => {
    const lines: string[] = [];
    appendTaskDeliveryContextSection(lines, {
      ...BASE,
      currentContext: { elapsedHours: 48 },
    });

    expect(lines.join('\n')).toContain('## Context');
    expect(lines.join('\n')).toContain('⚠️ Context is 2d old.');
    expect(lines.join('\n')).toContain('context new --chatroom-id="room-id"');
  });

  test('soft-warns when explicit context is >= 4h old', () => {
    const lines: string[] = [];
    appendTaskDeliveryContextSection(lines, {
      ...BASE,
      currentContext: { elapsedHours: 6 },
    });

    expect(lines.join('\n')).toContain('⚠️ Context is 6h old — consider refreshing if stale.');
  });

  test('legacy user origin warns on follow-up count and pinned message age', () => {
    const nowMs = Date.UTC(2026, 6, 1, 12, 0, 0);
    const lines: string[] = [];
    appendTaskDeliveryContextSection(lines, {
      ...BASE,
      originMessage: { senderRole: 'user' },
      followUpCountSinceOrigin: 5,
      originMessageCreatedAt: nowMs - 25 * 60 * 60 * 1000,
      nowMs,
    });

    const text = lines.join('\n');
    expect(text).toContain('⚠️ Stale: 5 follow-ups since pinned message.');
    expect(text).toContain('⚠️ Pinned message is 1d old.');
  });

  test('omits section when no context and origin is not from user', () => {
    const lines: string[] = [];
    appendTaskDeliveryContextSection(lines, {
      ...BASE,
      originMessage: { senderRole: 'planner' },
    });

    expect(lines).toEqual([]);
  });
});
