import { describe, expect, it } from 'vitest';

import {
  AgentOperationalReadModel,
  isOperationalDesiredRunning,
} from './agent-operational-read-model.js';

const row = (revisionKey: string, operationalState: 'running' | 'stopped' = 'running') => ({
  chatroomId: 'room-1',
  role: 'Builder',
  operationalState,
  isAlive: true,
  isRunning: true,
  daemonConnected: true,
  revisionKey,
});

describe('AgentOperationalReadModel', () => {
  it('tracks rows and reports revision changes', () => {
    const model = new AgentOperationalReadModel();
    expect(model.replace([row('one')])).toEqual([{ chatroomId: 'room-1', role: 'Builder' }]);
    expect(model.replace([row('one')])).toEqual([]);
    expect(model.replace([row('two')])).toEqual([{ chatroomId: 'room-1', role: 'Builder' }]);
    expect(model.get('room-1', 'builder')?.revisionKey).toBe('two');
  });

  it('treats running and starting as operationally desired', () => {
    expect(isOperationalDesiredRunning(row('one', 'running'))).toBe(true);
    expect(isOperationalDesiredRunning(row('one', 'stopped'))).toBe(false);
    expect(isOperationalDesiredRunning(undefined)).toBe(false);
  });

  it('applies hydrated signal rows and removals incrementally', () => {
    const model = new AgentOperationalReadModel();
    model.replace([row('one')]);

    expect(model.applySignalPage([row('two')], [])).toEqual([
      { chatroomId: 'room-1', role: 'Builder' },
    ]);
    expect(model.get('room-1', 'builder')?.revisionKey).toBe('two');

    expect(model.applySignalPage([], [{ chatroomId: 'room-1', role: 'builder' }])).toEqual([
      { chatroomId: 'room-1', role: 'builder' },
    ]);
    expect(model.get('room-1', 'builder')).toBeUndefined();
  });
});
