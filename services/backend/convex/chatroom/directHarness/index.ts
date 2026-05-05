/**
 * Barrel re-export for the direct-harness backend module.
 *
 * Endpoints are split into frontend-facing and daemon-facing files.
 * Uses the existing chatroom_workspaces table for workspace references.
 */

// Frontend-facing (web UI calls these)
export { create } from './frontend/sessions.js';
export { send, subscribe } from './frontend/messages.js';

// Daemon-facing (CLI daemon calls these)
export {
  associateHarnessSessionId,
  closeSession,
  updateCursor,
  listPendingSessionsForMachine,
} from './daemon/sessions.js';
export { appendMessages, pendingForMachine } from './daemon/messages.js';

// Capabilities (daemon-facing)
export { publishMachineCapabilities, listForWorkspace } from './capabilities.js';
