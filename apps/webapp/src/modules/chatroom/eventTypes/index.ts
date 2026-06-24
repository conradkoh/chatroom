/**
 * Event types module entry point.
 *
 * Builds and initializes the exhaustive event type registry.
 * The registry type requires ALL EventTypeName keys — TypeScript will error
 * at compile time if any event type is missing a renderer definition.
 *
 * To add a new event type:
 * 1. Add label + badge to SUPPORTED_EVENT_TYPES in domain/entities/event-type.ts
 * 2. Add the interface and EventStreamEvent union member in domain/entities/event-stream-event.ts
 * 3. Create renderer functions in the appropriate eventTypes/* file
 * 4. Export definitions and add them to the spread below
 */

import { agentEventDefinitions } from './agentEvents';
import { commandEventDefinitions } from './commandEvents';
import { configEventDefinitions } from './configEvents';
import { daemonEventDefinitions } from './daemonEvents';
import { initRegistry } from './registry';
import { skillEventDefinitions } from './skillEvents';
import { taskEventDefinitions } from './taskEvents';

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
    ...commandEventDefinitions,
  });
}
