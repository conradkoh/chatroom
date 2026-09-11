import { describe, expect, it } from 'vitest';

import {
  AgentOperationalReadModel,
  isOperationalCircuitOpen,
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

  it('recognizes an open start circuit', () => {
    expect(isOperationalCircuitOpen(row('one', 'running'))).toBe(false);
    expect(isOperationalCircuitOpen({ ...row('one'), operationalState: 'circuit_open' })).toBe(
      true
    );
    expect(isOperationalCircuitOpen(undefined)).toBe(false);
  });

  it('applies hydrated signal rows incrementally', () => {
    const model = new AgentOperationalReadModel();
    model.replace([row('one')]);

    expect(model.applySignalPage([row('two')])).toEqual([
      { chatroomId: 'room-1', role: 'Builder' },
    ]);
    expect(model.get('room-1', 'builder')?.revisionKey).toBe('two');
  });
});
