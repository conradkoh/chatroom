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
  projectedAt: 1,
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
});
