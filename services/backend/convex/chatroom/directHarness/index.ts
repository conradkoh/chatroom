/**
 * Barrel re-export for the direct-harness backend module.
 *
 * Endpoints are organised by resource (sessions, messages, capabilities).
 * Some are frontend-facing, others daemon-facing — see individual files.
 */

export {
  create,
  associateHarnessSessionId,
  closeSession,
  updateCursor,
  listPendingSessionsForMachine,
} from './sessions.js';

export {
  send,
  subscribe,
  appendMessages,
  pendingForMachine,
} from './messages.js';

export { publishMachineCapabilities, listForWorkspace } from './capabilities.js';
