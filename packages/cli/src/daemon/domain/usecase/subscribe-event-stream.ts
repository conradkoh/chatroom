import type { EventStreamEntry } from '../../../infrastructure/log-server/log-store.js';
import type { EventStreamHub } from '../../local-web/server/event-stream-hub.js';
export function createSubscribeEventStreamUseCase(deps: { hub: EventStreamHub }) {
  return (onEvent: (event: EventStreamEntry) => void): (() => void) => deps.hub.subscribe(onEvent);
}
