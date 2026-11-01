// fallow-ignore-file unused-file
/**
 * Daemon-side custom-agent service surface.
 *
 * Temporary marker: S3c wires this into the daemon and removes the suppression.
 */

export { createFileDisabledStateStore, type DisabledStateStore } from './disabled-state-store.js';
export {
  createCustomAgentsService,
  type CustomAgentsRefreshReason,
  type CustomAgentsService,
  type CustomAgentsServiceDeps,
} from './custom-agents-service.js';
