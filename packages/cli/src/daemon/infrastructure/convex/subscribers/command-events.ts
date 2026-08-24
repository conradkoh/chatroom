/** @deprecated Use machine-command-inbox subscriber. */
import { startMachineCommandInboxSubscriber } from './machine-command-inbox.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';

export function startCommandEventsSubscriber(deps: any, onEvent: (event: InboundEvent) => void) {
  return startMachineCommandInboxSubscriber(deps, async (claimed) =>
    onEvent({ type: 'command.received', commandId: claimed.commandId, claimedCommand: claimed })
  );
}
