/**
 * Barrel re-export for the direct-harness backend module.
 *
 * Uses the existing chatroom_workspaces table for workspace references —
 * harness sessions are associated with daemon-registered workspaces.
 */

export {
  openSession,
  associateHarnessSessionId,
  closeSession,
  updateSessionConfig,
  getSession,
  listSessionsByWorkspace,
} from './sessions.js';

export { appendMessages, streamSessionMessages } from './messages.js';

export {
  publishMachineCapabilities,
  listForWorkspace,
} from './capabilities.js';

export {
  submitPrompt,
  claimNextPendingPrompt,
  completePendingPrompt,
  getPendingPromptsForMachine,
} from './prompts.js';
