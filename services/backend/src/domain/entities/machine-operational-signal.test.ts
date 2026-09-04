import { describe, expect, it } from 'vitest';

import { machineOperationalSignalScopeValidator } from './machine-operational-signal';

describe('machineOperationalSignalScopeValidator', () => {
  it('requires exactly a machineId and a chatroom-scoped room reference', () => {
    expect(Object.keys(machineOperationalSignalScopeValidator)).toEqual([
      'machineId',
      'chatroomId',
    ]);
  });

  it('validates machineId as a string and chatroomId as a chatroom_rooms id', () => {
    expect(machineOperationalSignalScopeValidator.machineId).toMatchObject({ kind: 'string' });
    expect(machineOperationalSignalScopeValidator.chatroomId).toMatchObject({
      kind: 'id',
      tableName: 'chatroom_rooms',
    });
  });
});
