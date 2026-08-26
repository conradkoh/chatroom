export function createSessionLogCallbacks() {
  let logCb: ((line: string) => void) | undefined;
  return {
    onLogLine: (cb: (line: string) => void) => {
      logCb = cb;
    },
    emit: (line: string) => logCb?.(line),
    emitFormatted: (formatted: string, stream: 'stdout' | 'stderr' = 'stdout') =>
      logCb?.(`[${stream}] ${formatted}`),
  };
}
