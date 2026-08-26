import { DEFAULT_LOG_TIME_PRESET, type LogTimePreset } from './log-time-range';

export type EventStreamFilterValues = {
  chatroomId?: string;
  timeRange?: LogTimePreset;
  fromMs?: number;
  toMs?: number;
};
const validTimeRange = (v: string | null): LogTimePreset | undefined =>
  v && (['1h', '3h', '1d', 'custom'] as string[]).includes(v) ? (v as LogTimePreset) : undefined;
export function readEventStreamFiltersFromSearch(search: string): EventStreamFilterValues {
  const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const timeRange = validTimeRange(sp.get('timeRange'));
  const from = sp.get('from');
  const to = sp.get('to');
  const fromMs = Number(from);
  const toMs = Number(to);
  const chatroomId = sp.get('chatroomId');
  return {
    ...(chatroomId ? { chatroomId } : {}),
    ...(timeRange ? { timeRange } : {}),
    ...(Number.isFinite(fromMs) && from ? { fromMs } : {}),
    ...(Number.isFinite(toMs) && to ? { toMs } : {}),
  };
}
export function replaceEventStreamFiltersInUrl(filters: EventStreamFilterValues): void {
  const sp = new URLSearchParams(window.location.search);
  if (filters.chatroomId) sp.set('chatroomId', filters.chatroomId);
  else sp.delete('chatroomId');
  const p = filters.timeRange ?? DEFAULT_LOG_TIME_PRESET;
  sp.set('timeRange', p);
  if (p === 'custom' && filters.fromMs !== undefined && filters.toMs !== undefined) {
    sp.set('from', String(filters.fromMs));
    sp.set('to', String(filters.toMs));
  } else {
    sp.delete('from');
    sp.delete('to');
  }
  const qs = sp.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}
