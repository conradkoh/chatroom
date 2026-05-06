/**
 * Barrel re-export for the direct-harness backend module.
 *
 * Endpoints are now split by caller:
 *   api.daemon.directHarness.*  → daemon-facing endpoints
 *   api.web.directHarness.*     → web-facing endpoints
 *
 * This barrel re-exports everything for backward compat.
 */

export {
  create,
  listSessions,
} from '../../web/directHarness/sessions.js';

export {
  send,
  subscribe,
} from '../../web/directHarness/messages.js';

export {
  listForWorkspace,
} from '../../web/directHarness/capabilities.js';

export {
  associateHarnessSessionId,
  closeSession,
  updateCursor,
  getSession,
  listPendingSessionsForMachine,
} from '../../daemon/directHarness/sessions.js';

export {
  appendMessages,
  pendingForMachine,
} from '../../daemon/directHarness/messages.js';

export {
  publishMachineCapabilities,
} from '../../daemon/directHarness/capabilities.js';
