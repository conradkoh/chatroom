import { describe, expect, it, beforeEach } from 'vitest';

import { getRegisteredEventTypes, initializeEventTypes } from './index';
import { resolveEventTypeDefinition } from './resolveEventTypeDefinition';

import { SUPPORTED_EVENT_TYPE_NAMES } from '@/domain/entities/event-type';

describe('event type registry', () => {
  beforeEach(() => {
    initializeEventTypes();
  });

  it('registers every supported event type exhaustively', () => {
    const registered = getRegisteredEventTypes().sort();
    const expected = [...SUPPORTED_EVENT_TYPE_NAMES].sort();
    expect(registered).toEqual(expected);
  });

  it('resolves known event types from the registry', () => {
    const definition = resolveEventTypeDefinition({
      _id: 'evt_1',
      _creationTime: 1,
      timestamp: 1,
      type: 'agent.awaitingHandoff',
    });

    expect(definition.cellRenderer).toBeTypeOf('function');
    expect(definition.detailsRenderer).toBeTypeOf('function');
  });

  it('resolves agent.taskDelivered from the registry', () => {
    const definition = resolveEventTypeDefinition({
      _id: 'evt_task_delivered',
      _creationTime: 1,
      timestamp: 1,
      type: 'agent.taskDelivered',
    });

    expect(definition.cellRenderer).toBeTypeOf('function');
    expect(definition.detailsRenderer).toBeTypeOf('function');
  });

  it('falls back to placeholder renderers for unknown runtime event types', () => {
    const definition = resolveEventTypeDefinition({
      _id: 'evt_2',
      _creationTime: 2,
      timestamp: 2,
      type: 'future.unknownEvent',
    });

    expect(definition.cellRenderer).toBeTypeOf('function');
    expect(definition.detailsRenderer).toBeTypeOf('function');
  });
});
