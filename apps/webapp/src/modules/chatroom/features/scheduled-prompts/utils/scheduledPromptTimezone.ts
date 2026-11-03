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

/**
 * Parse an `<input type="datetime-local">` value ("YYYY-MM-DDTHH:mm" or
 * "YYYY-MM-DDTHH:mm:ss") in browser local time. `undefined` if empty or invalid.
 *
 * datetime-local has no timezone, so the components are passed to the local
 * `Date` constructor rather than parsed as a UTC string.
 */
export function localDateTimeInputToUtcMs(value: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return undefined;
  const ms = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0), 0).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Epoch ms -> `datetime-local` value in browser local time, minute precision
 * ("YYYY-MM-DDTHH:mm"). Every local component is padded to 2 digits (year to 4).
 */
export function utcMsToLocalDateTimeInput(ms: number): string {
  const d = new Date(ms);
  const year = String(d.getFullYear()).padStart(4, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
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
