import { describe, expect, it } from 'vitest';

import { AGENT_STATUS_EVENT_TYPES, resolveAgentStatus } from './agentStatusLabel';

describe('resolveAgentStatus', () => {
  it('maps agent.started to STARTED (not STARTING)', () => {
    const result = resolveAgentStatus('agent.started', 'running', true);
    expect(result).toEqual({ label: 'STARTED', variant: 'ready' });
  });

  it('maps agent.requestStart to STARTING', () => {
    const result = resolveAgentStatus('agent.requestStart', 'running', true);
    expect(result).toEqual({ label: 'STARTING', variant: 'transitioning' });
  });

  it('covers every known AgentStatusEventType with an explicit resolution', () => {
    for (const eventType of AGENT_STATUS_EVENT_TYPES) {
      const result = resolveAgentStatus(eventType, 'running', true);
      expect(result.label).toBeTruthy();
      expect(result.variant).toBeTruthy();
      if (eventType === 'agent.started') {
        expect(result.label).toBe('STARTED');
      }
    }
  });

  it('maps agent.exited with stopped to OFFLINE', () => {
    const result = resolveAgentStatus('agent.exited', 'stopped', true);
    expect(result).toEqual({ label: 'OFFLINE', variant: 'offline' });
  });

  it('maps agent.exited with running to OFFLINE (ERROR)', () => {
    const result = resolveAgentStatus('agent.exited', 'running', true);
    expect(result).toEqual({ label: 'OFFLINE (ERROR)', variant: 'error' });
  });

  it('maps agent.waiting with stopped to STOPPING', () => {
    const result = resolveAgentStatus('agent.waiting', 'stopped', true);
    expect(result).toEqual({ label: 'STOPPING', variant: 'transitioning' });
  });

  it('maps agent.waiting with running to WAITING', () => {
    const result = resolveAgentStatus('agent.waiting', 'running', true);
    expect(result).toEqual({ label: 'WAITING', variant: 'ready' });
  });

  it('returns OFFLINE for null event type', () => {
    const result = resolveAgentStatus(null, null, true);
    expect(result).toEqual({ label: 'OFFLINE', variant: 'offline' });
  });

  it('returns OFFLINE for undefined event type', () => {
    const result = resolveAgentStatus(undefined, undefined, true);
    expect(result).toEqual({ label: 'OFFLINE', variant: 'offline' });
  });

  it('maps session resume types', () => {
    expect(resolveAgentStatus('agent.sessionResumeRequested', 'running', true)).toEqual({
      label: 'RECONNECTING',
      variant: 'transitioning',
    });
    expect(resolveAgentStatus('agent.sessionResumed', 'running', true)).toEqual({
      label: 'RECONNECTED',
      variant: 'ready',
    });
    expect(resolveAgentStatus('agent.sessionResumeFailed', 'running', true)).toEqual({
      label: 'RECONNECT FAILED',
      variant: 'error',
    });
    expect(resolveAgentStatus('agent.sessionReopenRetry', 'running', true)).toEqual({
      label: 'RECONNECTING',
      variant: 'transitioning',
    });
  });

  it('maps agent.restart to RESTARTING', () => {
    const result = resolveAgentStatus('agent.restart', 'running', true);
    expect(result).toEqual({ label: 'RESTARTING', variant: 'transitioning' });
  });

  it('falls back to ONLINE for unknown event types', () => {
    const result = resolveAgentStatus('unknown.event', 'running', true);
    expect(result).toEqual({ label: 'ONLINE', variant: 'transitioning' });
  });
});
