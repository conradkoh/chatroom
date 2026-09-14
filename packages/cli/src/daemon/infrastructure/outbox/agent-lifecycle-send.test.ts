import { describe, expect, it, vi } from 'vitest';

import { createAgentLifecycleSend } from './agent-lifecycle-send.js';
import { api } from '../../../api.js';

describe('createAgentLifecycleSend', () => {
  it('sends non-activity facts through projectAgentLifecycleFact', async () => {
    const mutation = vi.fn().mockResolvedValue({ skipped: false });
    const session = { sessionId: 'session', machineId: 'machine', backend: { mutation } } as never;
    const fact = { kind: 'cleared_all_pids', revisionKey: 'clear:1', emittedAt: 1 } as const;
    await createAgentLifecycleSend(session)(fact);
    expect(mutation).toHaveBeenCalledWith(api.machines.projectAgentLifecycleFact, {
      sessionId: 'session',
      machineId: 'machine',
      fact,
    });
  });

  it('sends activity facts through the cheap heartbeat mutation', async () => {
    const mutation = vi.fn().mockResolvedValue({ success: true });
    const session = { sessionId: 'session', machineId: 'machine', backend: { mutation } } as never;
    const fact = {
      kind: 'activity',
      chatroomId: 'room',
      role: 'builder',
      action: 'heartbeat',
      revisionKey: 'activity:1',
      emittedAt: 1,
    } as const;
    await createAgentLifecycleSend(session)(fact);
    expect(mutation).toHaveBeenCalledWith(api.machines.recordAgentActivityHeartbeat, {
      sessionId: 'session',
      machineId: 'machine',
      fact,
    });
  });
});
