/**
 * Event types module entry point.
 * Imports all event type modules and registers them with the registry.
 */

import { registerAgentEvents } from './agentEvents';
import { registerConfigEvents } from './configEvents';
import { registerDaemonEvents } from './daemonEvents';
import { registerSkillEvents } from './skillEvents';
import { registerTaskEvents } from './taskEvents';
import { registerWorkflowEvents } from './workflowEvents';

// Re-export registry functions
export {
  getEventTypeDefinition,
  getRegisteredEventTypes,
  hasEventTypeRenderer,
  registerEventType,
} from './registry';

// Re-export shared components
export {
  DetailRow,
  EventDetails,
  EventRow,
  PlaceholderEventDetails,
  PlaceholderEventRow,
} from './shared';

// Re-export types
export type { BadgeColor } from './shared';

/**
 * Initialize all event type registrations.
 * Call this once at application startup.
 */
export function initializeEventTypes(): void {
  registerAgentEvents();
  registerTaskEvents();
  registerDaemonEvents();
  registerSkillEvents();
  registerConfigEvents();
  registerWorkflowEvents();
}
