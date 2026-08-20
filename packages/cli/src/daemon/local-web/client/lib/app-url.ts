export type AppTab = 'logs' | 'event-stream';

export function readTabFromSearch(search: string): AppTab {
  const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return sp.get('tab') === 'event-stream' ? 'event-stream' : 'logs';
}

export function readChatroomIdFromSearch(search: string): string | undefined {
  const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return sp.get('chatroomId') ?? undefined;
}

export function replaceAppUrlParams(updates: { tab?: AppTab; chatroomId?: string | null }): void {
  const sp = new URLSearchParams(window.location.search);
  if (updates.tab !== undefined) {
    if (updates.tab === 'event-stream') sp.set('tab', 'event-stream');
    else sp.delete('tab');
  }
  if (updates.chatroomId !== undefined) {
    if (updates.chatroomId) sp.set('chatroomId', updates.chatroomId);
    else sp.delete('chatroomId');
  }
  const qs = sp.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}
