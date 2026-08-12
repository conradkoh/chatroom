export type LogTimePreset = '1h' | '3h' | '1d' | 'custom';
export type LogTimeFilterValues = { timeRange?: LogTimePreset; fromMs?: number; toMs?: number };
export const DEFAULT_LOG_TIME_PRESET = '1h' as const;
export const LOG_TIME_PRESET_LABELS = {
  '1h': 'Last 1 hour',
  '3h': 'Last 3 hours',
  '1d': 'Last 1 day',
} as const;
export const LOG_TIME_PRESET_MS = { '1h': 3600000, '3h': 10800000, '1d': 86400000 } as const;
export function resolveTimeRange(v: LogTimeFilterValues, now = Date.now()) {
  if (v.timeRange === 'custom' && v.fromMs !== undefined && v.toMs !== undefined)
    return { fromMs: v.fromMs, toMs: v.toMs };
  return {
    fromMs: now - (LOG_TIME_PRESET_MS[v.timeRange as keyof typeof LOG_TIME_PRESET_MS] ?? 3600000),
    toMs: now,
  };
}
export function getTimeRangeLabel(v: LogTimeFilterValues) {
  const p = v.timeRange ?? '1h';
  if (p !== 'custom') return LOG_TIME_PRESET_LABELS[p];
  if (v.fromMs !== undefined && v.toMs !== undefined)
    return `${new Date(v.fromMs).toLocaleString()} – ${new Date(v.toMs).toLocaleString()}`;
  return 'Custom range';
}
export const toDatetimeLocalValue = (ms: number) => {
  const d = new Date(ms),
    p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromDatetimeLocalValue = (v: string) => {
  const ms = new Date(v).getTime();
  return Number.isFinite(ms) ? ms : undefined;
};
