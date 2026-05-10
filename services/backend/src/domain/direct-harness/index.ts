/**
 * Barrel for the direct-harness domain types and constants.
 *
 * Import from this barrel:
 *   import type { HarnessSessionStatus } from '@workspace/backend/src/domain/direct-harness/index.js';
 */

export type {
  HarnessSessionStatus,
  HarnessConfig,
  HarnessMessage,
  HarnessAgent,
  HarnessProvider,
  HarnessCapability,
  HarnessWorkspaceCapabilities,
  HarnessSessionSummary,
  HarnessCreateInput,
  HarnessCreateResult,
  HarnessSendMessageInput,
  HarnessSendMessageResult,
} from './types.js';

export {
  DEFAULT_FLUSH_INTERVAL,
  DEFAULT_HARNESS_NAME,
  TERMINAL_STATUSES,
  BLOCKED_STATUSES,
} from './constants.js';
