import { describe, expect, it, vi } from 'vitest';

import { createAgentCommandFactSend } from './agent-command-fact-send.js';
import { api } from '../../../api.js';
import type { AgentStoppedFact } from '../../services/agent-process-service/agent-stop-command/domain/entities/agent-fact.js';

const stoppedFact = (overrides?: Partial<AgentStoppedFact>): AgentStoppedFact => ({
  kind: 'agent.stopped',
  eventId: 'agent.stopped:cmd-1:room-1:builder',
  intentId: 'intent-1',
  commandId: 'cmd-1',
  machineId: 'machine-1',
  chatroomId: 'room-1',
  role: 'builder',
  pid: 4242,
  outcome: 'stopped',
  reason: 'user.stop',
  occurredAt: 1500,
  ...overrides,
});

describe('createAgentCommandFactSend', () => {
  it('sends through reportAgentStoppedFact with exact endpoint and args', async () => {
    const mutation = vi.fn().mockResolvedValue({ success: true, applied: true });
    const send = createAgentCommandFactSend({
      sessionId: 'session-1',
      machineId: 'machine-1',
      backend: { mutation },
    });
    const fact = stoppedFact();
    const result = await send(fact);
    expect(mutation).toHaveBeenCalledWith(api.agentStops.reportAgentStoppedFact, {
      sessionId: 'session-1',
      machineId: 'machine-1',
      fact: { ...fact, chatroomId: fact.chatroomId },
    });
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, skipped: false });
  });

  it('maps applied false to skipped true', async () => {
    const mutation = vi.fn().mockResolvedValue({ success: true, applied: false });
    const send = createAgentCommandFactSend({
      sessionId: 'session-1',
      machineId: 'machine-1',
      backend: { mutation },
    });
    expect(await send(stoppedFact())).toEqual({ success: true, skipped: true });
  });

  it('propagates sender errors', async () => {
    const mutation = vi.fn().mockRejectedValue(new Error('send failed'));
    const send = createAgentCommandFactSend({
      sessionId: 'session-1',
      machineId: 'machine-1',
      backend: { mutation },
    });
    await expect(send(stoppedFact())).rejects.toThrow('send failed');
  });

  it('does not send through legacy lifecycle or operational signal APIs', async () => {
    const mutation = vi.fn().mockResolvedValue({ success: true, applied: true });
    const send = createAgentCommandFactSend({
      sessionId: 'session-1',
      machineId: 'machine-1',
      backend: { mutation },
    });
    const fact = stoppedFact();
    await send(fact);
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledWith(api.agentStops.reportAgentStoppedFact, {
      sessionId: 'session-1',
      machineId: 'machine-1',
      fact: { ...fact, chatroomId: fact.chatroomId },
    });
  });
});
