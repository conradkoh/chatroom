import { Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';
import { onStopScopeAgentEffect } from './on-stop-scope-agent.js';
import { DaemonAgentProcessManagerService } from '../../daemon-services.js';

const event = (deadline: number) => ({ type: 'agent.stopScope' as const, machineId: 'machine', timestamp: Date.now(), commandId: 'cmd', stopCommandId: 'stop', chatroomId: 'room', scope: { kind: 'agent' as const, role: 'builder' }, reason: 'user.stop', deadline });
function layer(runInboxScopedStop: ReturnType<typeof vi.fn>) { return Layer.succeed(DaemonAgentProcessManagerService, { runInboxScopedStop: runInboxScopedStop as any, ensureRunning: vi.fn(), stop: vi.fn(), handleExit: vi.fn(), recover: vi.fn(), getSlot: vi.fn(), listActive: () => [], clearStuckStoppingSlot: vi.fn(), whenTurnEndsIdle: vi.fn(), resumeTurnForSlot: vi.fn(), setLastInFlightTask: vi.fn(), clearLastInFlightTaskIfMatches: vi.fn() }); }
describe('onStopScopeAgentEffect', () => {
  test('skips expired events', async () => { const spy = vi.fn(() => Effect.void); await Effect.runPromise(onStopScopeAgentEffect(event(Date.now() - 1)).pipe(Effect.provide(layer(spy)))); expect(spy).not.toHaveBeenCalled(); });
  test('delegates valid events', async () => { const spy = vi.fn(() => Effect.void); const input = event(Date.now() + 10000); await Effect.runPromise(onStopScopeAgentEffect(input).pipe(Effect.provide(layer(spy)))); expect(spy).toHaveBeenCalledWith(input); });
});
