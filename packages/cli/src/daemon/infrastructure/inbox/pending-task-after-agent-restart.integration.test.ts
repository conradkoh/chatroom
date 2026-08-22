/** Phase E: pending delivery is driven by the operational read model, not snapshot desiredState. */
import { Context, Effect, Runtime } from 'effect';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { handleTaskInboxUpdate } from './task-inbox-delivery.js';
import { operationalRow, registerTestNativeDeliverySession } from '../agent-operational/test-support.js';
import { unregisterNativeDeliverySession } from '../../entry/native-delivery/native-delivery-session-registry.js';
import { RecoveryCooldown } from '../../entry/task-delivery/task-delivery-logic.js';

const inject = vi.hoisted(() => vi.fn(() => Effect.void));
vi.mock('../../entry/native-delivery/native-task-injector.js', () => ({ runNativeInjectionEffect: inject }));
const pending = () => ({ taskId: 'phase-e-task' as never, chatroomId: 'phase-e-room' as never, status: 'pending' as const, assignedTo: 'builder', updatedAt: 1, createdAt: 1, agentConfig: { role: 'builder', machineId: 'phase-e-machine', agentHarness: 'cursor-sdk', workingDir: '/tmp' }, participant: { lastSeenAction: null, lastSeenAt: null, lastStatus: null } });
const manager = (slot: unknown) => ({ getSlot: vi.fn(() => slot), ensureRunning: vi.fn().mockResolvedValue({ success: true, pid: 42 }), clearStuckStoppingSlot: vi.fn().mockResolvedValue(false), setLastInFlightTask: vi.fn(() => Effect.void) }) as never;

describe('Phase E — pending task after agent restart', () => {
  afterEach(() => { unregisterNativeDeliverySession(); vi.clearAllMocks(); });
  test('delivers pending task when operational row is running without snapshot desiredState', async () => {
    const row = pending();
    const agentMgr = manager({ state: 'running', pid: 42, harnessSessionId: 'session', nativeTurnPhase: 'idle' });
    registerTestNativeDeliverySession({ runtime: Runtime.defaultRuntime as never, effectContext: Context.empty() as never, agentMgr, sessionDeps: {} as never, machineId: 'phase-e-machine', operationalRows: [operationalRow('phase-e-room', 'builder', 'running')] });
    await handleTaskInboxUpdate({ signals: [], snapshots: [row as never], afterSignalKey: 'a', throughSignalKey: 'b' }, { runtime: Runtime.defaultRuntime as never, effectContext: Context.empty() as never, cooldown: new RecoveryCooldown(0), agentMgr, sessionDeps: {} as never, machineId: 'phase-e-machine' });
    await vi.waitFor(() => expect(inject).toHaveBeenCalled());
    expect(row.agentConfig).not.toHaveProperty('desiredState');
  });
});
