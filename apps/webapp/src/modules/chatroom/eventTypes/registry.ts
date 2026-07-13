/**
 * Registry for event type renderers.
 * Maps event types to their cell (list row) and details (side panel) renderers.
 *
 * The registry is a REQUIRED record — every EventTypeName must have a definition.
 * This provides compile-time exhaustiveness: adding a new event type to the
 * EventStreamEvent union without registering a renderer causes a TypeScript error.
 */

import type { ReactNode } from 'react';

import type { EventStreamEvent } from '@/domain/entities/event-stream-event';
import type { EventTypeName } from '@/domain/entities/event-type';

/**
 * Definition for how to render an event type.
 * @template T - The specific event type this definition handles
 */
export interface EventTypeDefinition<T extends EventStreamEvent> {
  /** Renders a compact list row (type badge + key info + timestamp) */
  cellRenderer: (event: T, isSelected: boolean) => ReactNode;
  /** Renders the full attribute view for the side panel */
  detailsRenderer: (event: T) => ReactNode;
}

/**
 * Registry mapping event types to their renderers.
 * All EventTypeName keys are REQUIRED — TypeScript will error if any key is missing.
 * This is the exhaustiveness check: you cannot add a new event type without
 * also providing a renderer definition.
 */
export type EventTypeRegistry = {
  [K in EventTypeName]: EventTypeDefinition<Extract<EventStreamEvent, { type: K }>>;
};

// The active registry (set once via initRegistry)
let _registry: EventTypeRegistry | undefined;

/**
 * Initialize the registry with a complete, exhaustive definitions map.
 * TypeScript enforces that all EventTypeName keys are present in `defs`.
 */
export function initRegistry(defs: EventTypeRegistry): void {
  _registry = defs;
}

/**
 * Get the renderer definition for an event type.
 * Throws if the registry has not been initialized.
 */
export function getEventTypeDefinition<K extends EventTypeName>(
  type: K
): EventTypeDefinition<Extract<EventStreamEvent, { type: K }>> {
  if (!_registry) throw new Error('Event type registry not initialized');
  const definition = _registry[type];
  if (!definition) {
    throw new Error(`Missing event type definition for ${type}`);
  }
  return definition;
}

/**
 * Get all registered event types.
 */
export function getRegisteredEventTypes(): EventTypeName[] {
  if (!_registry) return [];
  return Object.keys(_registry) as EventTypeName[];
}
