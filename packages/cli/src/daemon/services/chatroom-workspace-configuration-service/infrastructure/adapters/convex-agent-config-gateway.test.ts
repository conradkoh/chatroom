import { describe, expect, test } from 'vitest';

import { mapAgentConfigInboxRows } from './convex-agent-config-gateway.js';

describe('mapAgentConfigInboxRows', () => {
  test('accepts a Convex document including system creation time', () => {
    expect(
      mapAgentConfigInboxRows([
        {
          _id: 'event-1',
          _creationTime: 123,
          machineId: 'machine-1',
          chatroomId: 'room-1',
          role: 'builder',
          agentType: 'remote',
          agentHarness: 'codex-sdk',
          model: 'model-1',
          workingDir: '/workspace',
          status: 'pending',
          createdAt: 456,
        },
      ])
    ).toEqual([
      {
        eventId: 'event-1',
        _creationTime: 123,
        machineId: 'machine-1',
        chatroomId: 'room-1',
        role: 'builder',
        agentType: 'remote',
        agentHarness: 'codex-sdk',
        model: 'model-1',
        workingDir: '/workspace',
        status: 'pending',
        createdAt: 456,
      },
    ]);
  });

  test('accepts processed rows without leaking transport bookkeeping', () => {
    expect(
      mapAgentConfigInboxRows([
        {
          _id: 'event-1',
          _creationTime: 123,
          machineId: 'machine-1',
          chatroomId: 'room-1',
          role: 'builder',
          agentType: 'remote',
          agentHarness: 'codex-sdk',
          model: 'model-1',
          workingDir: '/workspace',
          status: 'processed',
          createdAt: 456,
          processedAt: 900,
        },
      ])
    ).toEqual([
      {
        eventId: 'event-1',
        _creationTime: 123,
        machineId: 'machine-1',
        chatroomId: 'room-1',
        role: 'builder',
        agentType: 'remote',
        agentHarness: 'codex-sdk',
        model: 'model-1',
        workingDir: '/workspace',
        status: 'processed',
        createdAt: 456,
      },
    ]);
  });

  test('rejects genuinely unknown fields', () => {
    expect(() =>
      mapAgentConfigInboxRows([
        {
          _id: 'event-1',
          _creationTime: 123,
          machineId: 'machine-1',
          chatroomId: 'room-1',
          role: 'builder',
          agentType: 'remote',
          agentHarness: 'codex-sdk',
          model: 'model-1',
          workingDir: '/workspace',
          status: 'pending',
          createdAt: 456,
          unexpectedField: true,
        },
      ])
    ).toThrow(/unexpectedField/);
  });
});
