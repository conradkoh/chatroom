import { BaseCLIAgentService } from './base-cli-agent-service.js';
import type { RemoteAgentService } from './remote-agent-service.js';

/**
 * Require a registered harness service to extend BaseCLIAgentService.
 *
 * Every registered service must extend the base class, so a non-base service is
 * a wiring bug — throw rather than silently falling back to boolean detection.
 */
export function requireBaseAgentService(service: RemoteAgentService): BaseCLIAgentService {
  if (!(service instanceof BaseCLIAgentService)) {
    throw new Error(`Harness "${service.id}" must extend BaseCLIAgentService`);
  }
  return service;
}
