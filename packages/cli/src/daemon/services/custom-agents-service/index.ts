/**
 * Daemon-side custom-agent service surface.
 *
 * Only what the daemon consumes is re-exported: the production factory and the
 * service type. The store and the service constructor stay reachable through
 * their own modules, so the public surface cannot drift from real callers.
 */

export { buildCustomAgentsService } from './build-custom-agents-service.js';
export type { CustomAgentsService } from './custom-agents-service.js';
