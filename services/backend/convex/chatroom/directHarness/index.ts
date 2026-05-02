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
  updateSessionAgent,
  getSession,
  listSessionsByWorkspace,
} from './sessions.js';

export { appendMessages, streamSessionMessages } from './messages.js';

export { publishMachineCapabilities, getMachineRegistry } from './capabilities.js';

export {
  submitPrompt,
  updateSessionAgentWithValidation,
  claimNextPendingPrompt,
  completePendingPrompt,
  getPendingPromptsForMachine,
  getSessionPromptQueue,
} from './prompts.js';
