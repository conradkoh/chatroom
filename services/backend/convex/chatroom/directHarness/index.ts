/**
 * Barrel re-export for the direct-harness backend module.
 *
 * Endpoints are organised by resource (sessions, messages, capabilities).
 * Some are frontend-facing, others daemon-facing — see individual files.
 */

export {
  create,
  listSessions,
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
// TODO: re-export requestRefresh once capabilities auto-publish is implemented
// export { requestRefresh } from './capabilities.js';
