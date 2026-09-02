type FormatOptions = {
  timeZone?: string;
};

/** HH:MM:SS in the user's local timezone (24-hour). */
export function formatLocalLogTime(timestamp: number, options?: FormatOptions): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: options?.timeZone,
  });
}

/** Full local date-time for detail panels. */
export function formatLocalLogDateTime(timestamp: number, options?: FormatOptions): string {
  return new Date(timestamp).toLocaleString(undefined, {
    timeZone: options?.timeZone,
  });
}
