/**
 * Registry for event type renderers.
 * Maps event types to their cell (list row) and details (side panel) renderers.
 */

import type { ReactNode } from 'react';

import type { EventStreamEvent, EventTypeName } from '../viewModels/eventStreamViewModel';

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
 * Keys are event type strings, values are the renderer definitions.
 */
type EventTypeRegistry = {
  [K in EventTypeName]?: EventTypeDefinition<Extract<EventStreamEvent, { type: K }>>;
};

// Create the registry object
const registry: EventTypeRegistry = {};

/**
 * Register an event type definition.
 * @param type - The event type string
 * @param definition - The cell and details renderers
 */
export function registerEventType<K extends EventTypeName>(
  type: K,
  definition: EventTypeDefinition<Extract<EventStreamEvent, { type: K }>>
): void {
  registry[type] = definition as EventTypeRegistry[K];
}

/**
 * Get the renderer definition for an event type.
 * @param type - The event type string
 * @returns The definition or undefined if not registered
 */
export function getEventTypeDefinition<K extends EventTypeName>(
  type: K
): EventTypeDefinition<Extract<EventStreamEvent, { type: K }>> | undefined {
  return registry[type] as EventTypeDefinition<Extract<EventStreamEvent, { type: K }>> | undefined;
}

/**
 * Check if an event type is registered.
 * @param type - The event type string
 */
export function hasEventTypeRenderer(type: string): boolean {
  return type in registry;
}

/**
 * Get all registered event types.
 */
export function getRegisteredEventTypes(): EventTypeName[] {
  return Object.keys(registry) as EventTypeName[];
}

// Re-export for convenience
export type { EventTypeDefinition as EventTypeDef };