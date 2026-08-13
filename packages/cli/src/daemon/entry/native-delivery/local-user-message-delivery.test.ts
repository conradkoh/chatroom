import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, Effect, Runtime } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import { handleUserMessageInbound } from '../../domain/usecase/handle-user-message-inbound.js';
import { openDatabase } from '../../infrastructure/persistence/open-database.js';
import { setNativeDeliveryReadModelDb, getNativeTaskDeliveryCoordinator } from './native-task-delivery-coordinator.js';
import { registerNativeDeliverySession, unregisterNativeDeliverySession } from './native-delivery-session-registry.js';

describe('local user-message delivery', () => {
  it('ingests then injects without backend calls', async () => {
    for (const flag of ['P2', 'P2_CUTOVER', 'P3', 'P3_LOCAL_DELIVERY', 'P7']) process.env[`DAEMON_ORCHESTRATION_${flag}`] = '1';
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'p7-delivery-')), 'db.sqlite'));
    const resumeTurnForSlot = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn(); const mutation = vi.fn();
    setNativeDeliveryReadModelDb(db);
    registerNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never, effectContext: Context.empty() as never, machineId: 'machine',
      agentMgr: { getSlot: () => ({ state: 'running', pid: 1, nativeTurnPhase: 'idle', harnessSessionId: 'harness' }), resumeTurnForSlot, setLastInFlightTask: () => Effect.void } as never,
      sessionDeps: { sessionId: 'session', convexUrl: '', machineId: 'machine', backend: { query, mutation } },
    });
    try {
      await handleUserMessageInbound({ db, machineId: 'machine', sessionId: 'session', appendEvent: vi.fn(), emitOrchestrationEvent: (event) => { if (event.source === 'user-message') getNativeTaskDeliveryCoordinator().tryInjectNextForRole(event.chatroomId, event.role); }, query: vi.fn(), getEntryPointRole: async () => 'planner', getAgentHarness: async () => 'cursor-sdk' }, { chatroomId: 'room', messageId: 'message', content: 'USER CONTENT', senderRole: 'user' });
      await vi.waitFor(() => expect(resumeTurnForSlot).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining('USER CONTENT') })));
      expect(query).not.toHaveBeenCalled(); expect(mutation).not.toHaveBeenCalled();
    } finally { unregisterNativeDeliverySession(); db.close(); for (const flag of ['P2', 'P2_CUTOVER', 'P3', 'P3_LOCAL_DELIVERY', 'P7']) delete process.env[`DAEMON_ORCHESTRATION_${flag}`]; }
  });
});
