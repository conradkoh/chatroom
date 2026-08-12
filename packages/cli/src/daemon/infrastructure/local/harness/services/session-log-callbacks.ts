import type { AgentLogLine } from './remote-agent-service.js';

export function createSessionLogCallbacks() {
  let logCb: ((entry: AgentLogLine) => void) | undefined;
  return {
    onLogLine: ((cb: (entry: AgentLogLine) => void) => {
      logCb = cb;
    }) as any,
    emit: (entry: AgentLogLine) => logCb?.(entry),
    emitFormatted: (formatted: string, stream: 'stdout' | 'stderr' = 'stdout') =>
      logCb?.({ stream, message: formatted }),
  };
}
