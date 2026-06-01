/**
 * Event types module entry point.
 *
 * Builds and initializes the exhaustive event type registry.
 * The registry type requires ALL EventTypeName keys — TypeScript will error
 * at compile time if any event type is missing a renderer definition.
 *
 * To add a new event type:
 * 1. Add the type to EventTypeName and EventStreamEvent in eventStreamViewModel.ts
 * 2. Add the interface to eventStreamViewModel.ts
 * 3. Create the renderer functions in the appropriate eventType file
 * 4. Export the definitions from that file and add them to the spread below
 */

import { agentEventDefinitions } from './agentEvents';
import { configEventDefinitions } from './configEvents';
import { daemonEventDefinitions } from './daemonEvents';
import { initRegistry } from './registry';
import { skillEventDefinitions } from './skillEvents';
import { taskEventDefinitions } from './taskEvents';
import { workflowEventDefinitions } from './workflowEvents';

// Re-export registry query functions
export { getEventTypeDefinition, getRegisteredEventTypes } from './registry';

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
 * Initialize the event type registry.
 *
 * The spread below must cover every key in EventTypeName.
 * TypeScript enforces this: missing any key is a compile-time error.
 * Call once at application startup (e.g. top of EventStreamModal).
 */
export function initializeEventTypes(): void {
  initRegistry({
    ...agentEventDefinitions,
    ...taskEventDefinitions,
    ...daemonEventDefinitions,
    ...skillEventDefinitions,
    ...configEventDefinitions,
    ...workflowEventDefinitions,
  });
}
