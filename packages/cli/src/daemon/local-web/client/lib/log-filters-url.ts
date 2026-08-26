import { DEFAULT_LOG_TIME_PRESET, type LogTimePreset } from './log-time-range';
import type { LogFilterValues } from '../components/logs/LogFiltersBar';

const valid = (v: string | null): LogTimePreset | undefined =>
  v && (['1h', '3h', '1d', 'custom'] as string[]).includes(v) ? (v as LogTimePreset) : undefined;
export function readLogFiltersFromSearch(search: string): LogFilterValues {
  const sp = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const timeRange = valid(sp.get('timeRange'));
  const fromMs = Number(sp.get('from'));
  const toMs = Number(sp.get('to'));
  const chatroomId = sp.get('chatroomId');
  const role = sp.get('role');
  const harness = sp.get('harness');
  return {
    ...(chatroomId ? { chatroomId } : {}),
    ...(role ? { role } : {}),
    ...(harness ? { harness } : {}),
    ...(timeRange ? { timeRange } : {}),
    ...(Number.isFinite(fromMs) && sp.get('from') ? { fromMs } : {}),
    ...(Number.isFinite(toMs) && sp.get('to') ? { toMs } : {}),
  };
}
export function writeLogFiltersToSearch(filters: LogFilterValues): string {
  const sp = new URLSearchParams();
  if (filters.chatroomId) sp.set('chatroomId', filters.chatroomId);
  if (filters.role) sp.set('role', filters.role);
  if (filters.harness) sp.set('harness', filters.harness);
  const p = filters.timeRange ?? DEFAULT_LOG_TIME_PRESET;
  sp.set('timeRange', p);
  if (p === 'custom' && filters.fromMs !== undefined && filters.toMs !== undefined) {
    sp.set('from', String(filters.fromMs));
    sp.set('to', String(filters.toMs));
  }
  return sp.toString();
}
export function replaceLogFiltersInUrl(filters: LogFilterValues): void {
  const qs = writeLogFiltersToSearch(filters);
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
}
