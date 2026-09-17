import {
  LocalDaemonServerError,
  requestLocalDaemon,
} from '../../commands/diagnostics/local-daemon.js';
import type { HandoffGatewayOps, HandoffResult } from '../../commands/handoff/deps.js';
import { resolveLocalWebPort } from '../../daemon/entry/resolve-local-web-port.js';

export function createLocalHandoffGateway(): HandoffGatewayOps {
  return {
    handoff: (args) =>
      requestLocalDaemon<HandoffResult>(resolveLocalWebPort(), 'cli.handoff', args).catch(
        (error) => {
          if (error instanceof LocalDaemonServerError) throw error;
          throw new Error(
            `CLI gateway unavailable. Start the Chatroom daemon and retry. ${error instanceof Error ? error.message : String(error)}`
          );
        }
      ),
  };
}
