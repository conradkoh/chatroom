import { describe, expect, it, vi } from 'vitest';

import { createAgentCommandInbox } from './agent-command-inbox.js';
import { api } from '../../../api.js';

function makeBackend(claim: unknown) {
  return { mutation: vi.fn().mockResolvedValue(claim) };
}

function makeWsClient() {
  const onUpdate = vi.fn((_query: unknown, _args: unknown, _cb: unknown, _err: unknown) => {
    const unsub = vi.fn();
    return unsub;
  });
  return { onUpdate } as unknown as {
    onUpdate: typeof onUpdate;
  };
}

describe('createAgentCommandInbox', () => {
  it('maps a flattened agent.stop envelope with agent scope', async () => {
    const envelope = {
      commandId: 'cmd-1',
      machineId: 'machine-1',
      type: 'agent.stop',
      intentId: 'intent-1',
      chatroomId: 'room-1',
      scope: { kind: 'agent', role: 'builder' },
      reason: 'user.stop',
      timestamp: 1000,
      deadline: 2000,
    };
    const backend = makeBackend(envelope);
    const wsClient = makeWsClient();
    const inbox = createAgentCommandInbox({
      wsClient: wsClient as never,
      backend,
      sessionId: 'session-1' as never,
      machineId: 'machine-1',
    });
    const command = await inbox.claimNext();
    expect(backend.mutation).toHaveBeenCalledWith(api.daemon.agentCommandInbox.claimNext, {
      sessionId: 'session-1',
      machineId: 'machine-1',
    });
    expect(command).toEqual({
      commandId: 'cmd-1',
      intentId: 'intent-1',
      machineId: 'machine-1',
      target: { kind: 'agent', chatroomId: 'room-1', role: 'builder' },
      reason: 'user.stop',
      createdAt: 1000,
      deadlineAt: 2000,
    });
  });

  it('maps a flattened agent.stop envelope with chatroom scope', async () => {
    const envelope = {
      commandId: 'cmd-2',
      machineId: 'machine-1',
      type: 'agent.stop',
      intentId: 'intent-2',
      chatroomId: 'room-9',
      scope: { kind: 'chatroom' },
      reason: 'daemon.shutdown',
      timestamp: 1100,
      deadline: 2200,
    };
    const backend = makeBackend(envelope);
    const inbox = createAgentCommandInbox({
      wsClient: makeWsClient() as never,
      backend,
      sessionId: 'session-1' as never,
      machineId: 'machine-1',
    });
    const command = await inbox.claimNext();
    expect(command).toEqual({
      commandId: 'cmd-2',
      intentId: 'intent-2',
      machineId: 'machine-1',
      target: { kind: 'chatroom', chatroomId: 'room-9' },
      reason: 'daemon.shutdown',
      createdAt: 1100,
      deadlineAt: 2200,
    });
  });

  it('maps null claim to null', async () => {
    const backend = makeBackend(null);
    const inbox = createAgentCommandInbox({
      wsClient: makeWsClient() as never,
      backend,
      sessionId: 'session-1' as never,
      machineId: 'machine-1',
    });
    expect(await inbox.claimNext()).toBeNull();
  });

  it('passes exact command id to acknowledge and renew and propagates errors', async () => {
    const backend = { mutation: vi.fn().mockResolvedValue({}) };
    const inbox = createAgentCommandInbox({
      wsClient: makeWsClient() as never,
      backend,
      sessionId: 'session-1' as never,
      machineId: 'machine-1',
    });
    await inbox.acknowledge('cmd-ack');
    expect(backend.mutation).toHaveBeenCalledWith(api.daemon.agentCommandInbox.acknowledge, {
      sessionId: 'session-1',
      commandId: 'cmd-ack',
    });
    await inbox.renew('cmd-renew');
    expect(backend.mutation).toHaveBeenCalledWith(api.daemon.agentCommandInbox.renewClaim, {
      sessionId: 'session-1',
      commandId: 'cmd-renew',
    });

    backend.mutation.mockRejectedValueOnce(new Error('ack failed'));
    await expect(inbox.acknowledge('cmd-ack')).rejects.toThrow('ack failed');
    backend.mutation.mockRejectedValueOnce(new Error('renew failed'));
    await expect(inbox.renew('cmd-renew')).rejects.toThrow('renew failed');
  });

  it('invokes availability only for non-null command id and returns unsubscribe', async () => {
    const wsClient = makeWsClient();
    const inbox = createAgentCommandInbox({
      wsClient: wsClient as never,
      backend: makeBackend(null),
      sessionId: 'session-1' as never,
      machineId: 'machine-1',
    });
    const onAvailable = vi.fn();
    const onError = vi.fn();
    const unsubscribe = inbox.subscribe(onAvailable, onError);
    expect(wsClient.onUpdate).toHaveBeenCalledTimes(1);
    expect(wsClient.onUpdate).toHaveBeenCalledWith(
      api.daemon.agentCommandInbox.watchNext,
      { sessionId: 'session-1', machineId: 'machine-1' },
      expect.any(Function),
      expect.any(Function)
    );
    const [, args, onResult, onErr] = wsClient.onUpdate.mock.calls[0] as [
      unknown,
      unknown,
      (result: { commandId: unknown } | null) => void,
      (error: unknown) => void,
    ];
    expect(args).toEqual({ sessionId: 'session-1', machineId: 'machine-1' });

    onResult({ commandId: 'cmd-1' });
    expect(onAvailable).toHaveBeenCalledTimes(1);
    onResult({ commandId: null });
    onResult(null);
    expect(onAvailable).toHaveBeenCalledTimes(1);

    const failure = new Error('watch failed');
    onErr(failure);
    expect(onError).toHaveBeenCalledWith(failure);

    const innerUnsub = wsClient.onUpdate.mock.results[0]?.value as () => void;
    expect(typeof unsubscribe).toBe('function');
    if (unsubscribe !== (innerUnsub as unknown)) throw new Error('unsubscribe not returned');
  });

  it('does not call legacy stop-signal or generic machine inbox APIs', async () => {
    const backend = makeBackend(null);
    const wsClient = makeWsClient();
    const inbox = createAgentCommandInbox({
      wsClient: wsClient as never,
      backend,
      sessionId: 'session-1' as never,
      machineId: 'machine-1',
    });
    await inbox.claimNext();
    await inbox.acknowledge('cmd-1').catch(() => undefined);
    await inbox.renew('cmd-1').catch(() => undefined);
    inbox.subscribe(() => undefined);
    expect(backend.mutation).toHaveBeenCalledWith(
      api.daemon.agentCommandInbox.claimNext,
      expect.objectContaining({ machineId: 'machine-1' })
    );
    expect(backend.mutation).toHaveBeenCalledWith(
      api.daemon.agentCommandInbox.acknowledge,
      expect.objectContaining({ commandId: 'cmd-1' })
    );
    expect(backend.mutation).toHaveBeenCalledWith(
      api.daemon.agentCommandInbox.renewClaim,
      expect.objectContaining({ commandId: 'cmd-1' })
    );
    expect(wsClient.onUpdate).toHaveBeenCalledWith(
      api.daemon.agentCommandInbox.watchNext,
      expect.objectContaining({ machineId: 'machine-1' }),
      expect.any(Function),
      expect.any(Function)
    );
    expect(backend.mutation.mock.calls).toHaveLength(3);
  });
});
