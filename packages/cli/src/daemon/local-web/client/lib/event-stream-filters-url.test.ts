import { describe, expect, it, vi } from 'vitest';
import { readEventStreamFiltersFromSearch, replaceEventStreamFiltersInUrl } from './event-stream-filters-url';
describe('event stream filter URL', () => {
  it('reads defaults and values', () => { expect(readEventStreamFiltersFromSearch('?tab=event-stream')).toEqual({}); expect(readEventStreamFiltersFromSearch('?timeRange=3h&chatroomId=room')).toMatchObject({ timeRange: '3h', chatroomId: 'room' }); });
  it('round trips custom filters and preserves unrelated params', () => {
    const location = { pathname: '/', search: '?tab=event-stream&role=builder' }; vi.stubGlobal('window', { location, history: { replaceState: (_s: unknown, _t: string, url: string) => { const [p, q = ''] = url.split('?'); location.pathname = p; location.search = q ? `?${q}` : ''; } } });
    replaceEventStreamFiltersInUrl({ chatroomId: 'room', timeRange: 'custom', fromMs: 10, toMs: 20 });
    expect(location.search).toContain('tab=event-stream'); expect(location.search).toContain('role=builder'); expect(readEventStreamFiltersFromSearch(location.search)).toMatchObject({ chatroomId: 'room', timeRange: 'custom', fromMs: 10, toMs: 20 });
  });
});
