import { describe, expect, it, vi } from 'vitest';

import { readChatroomIdFromSearch, readTabFromSearch, replaceAppUrlParams } from './app-url';

describe('app URL helpers', () => {
  it('reads tab and chatroom defaults', () => {
    expect(readTabFromSearch('?role=builder')).toBe('logs');
    expect(readTabFromSearch('?tab=event-stream')).toBe('event-stream');
    expect(readChatroomIdFromSearch('?chatroomId=room-a')).toBe('room-a');
  });

  it('updates app params while preserving unrelated params', () => {
    const location = { pathname: '/', search: '?role=builder' };
    vi.stubGlobal('window', {
      location,
      history: { replaceState: (_state: unknown, _title: string, url: string) => {
        const [pathname, search = ''] = url.split('?');
        location.pathname = pathname;
        location.search = search ? `?${search}` : '';
      } },
    });
    replaceAppUrlParams({ tab: 'event-stream', chatroomId: 'room-a' });
    expect(window.location.search).toBe('?role=builder&tab=event-stream&chatroomId=room-a');
    replaceAppUrlParams({ tab: 'logs', chatroomId: null });
    expect(window.location.search).toBe('?role=builder');
  });
});
