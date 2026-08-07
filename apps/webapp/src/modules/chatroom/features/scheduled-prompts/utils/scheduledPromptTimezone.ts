export function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function formatTimezoneLabel(tz?: string): string {
  const timezone = tz ?? getBrowserTimezone();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    const offset = parts.find((p) => p.type === 'timeZoneName')?.value;
    return offset ? `${timezone} (${offset})` : timezone;
  } catch {
    return timezone;
  }
}

export function localDailyTimeToUtc(
  hour: number,
  minute: number,
  refDate: Date = new Date()
): { hourUTC: number; minuteUTC: number } {
  const d = new Date(refDate);
  d.setHours(hour, minute, 0, 0);
  return { hourUTC: d.getUTCHours(), minuteUTC: d.getUTCMinutes() };
}

export function utcDailyTimeToLocal(
  hourUTC: number,
  minuteUTC: number,
  refDate: Date = new Date()
): { hour: number; minute: number } {
  const d = new Date(refDate);
  d.setUTCHours(hourUTC, minuteUTC, 0, 0);
  return { hour: d.getHours(), minute: d.getMinutes() };
}

/** Format epoch ms as HH:MM in browser local time. No TZ suffix — assumed local. */
export function formatTimestampLocal(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/** Format daily schedule in browser local time. No TZ suffix — assumed local. */
export function formatDailyScheduleLocal(hourUTC: number, minuteUTC: number): string {
  const { hour, minute } = utcDailyTimeToLocal(hourUTC, minuteUTC);
  const h = String(hour).padStart(2, '0');
  const m = String(minute).padStart(2, '0');
  return `Daily at ${h}:${m}`;
}

/** Only use when displaying a time explicitly in a non-browser timezone. */
export function formatTimestampInTimezone(ts: number, timeZone: string): string {
  const d = new Date(ts);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const label = formatTimezoneLabel(timeZone);
  const browserTz = getBrowserTimezone();
  if (timeZone === browserTz) return `${h}:${m}`;
  return `${h}:${m} (${label})`;
}
