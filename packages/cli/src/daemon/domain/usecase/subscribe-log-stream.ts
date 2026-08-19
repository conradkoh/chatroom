import type { LogStreamEvent, LogStreamHub } from '../../local-web/server/log-stream-hub.js';

export function createSubscribeLogStreamUseCase(deps: { hub: LogStreamHub }) {
  return (onEvent: (event: LogStreamEvent) => void): (() => void) =>
    deps.hub.subscribe(onEvent);
}
