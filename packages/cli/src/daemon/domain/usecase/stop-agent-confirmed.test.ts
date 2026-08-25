import { describe, expect, it, vi } from 'vitest';

import { stopAgentConfirmed } from './stop-agent-confirmed.js';

const target = {
  chatroomId: 'c',
  role: 'Builder',
  pid: 7,
  agentHarness: 'opencode',
  machineId: 'm',
  targetKey: 'm:builder:7',
};
function deps(alive = true) {
  return {
    harnessStop: { stop: vi.fn(async () => {}) },
    liveness: { isAlive: vi.fn(() => alive) },
    lifecycle: { awaitExitedFact: vi.fn(async () => {}) },
  };
}
describe('stopAgentConfirmed', () => {
  it('requires an explicit harness', async () => {
    const d = deps();
    await expect(
      stopAgentConfirmed(d, {
        target: { ...target, agentHarness: '' },
        reason: 'user.stop',
        revisionKey: 'r',
      })
    ).rejects.toMatchObject({ code: 'harness_missing' });
  });
  it('delivers an already-stopped fact for a dead pid', async () => {
    const d = deps(false);
    await expect(
      stopAgentConfirmed(d, { target, reason: 'user.stop', revisionKey: 'r' })
    ).resolves.toMatchObject({ kind: 'already_stopped' });
    expect(d.lifecycle.awaitExitedFact).toHaveBeenCalledTimes(1);
  });
  it('uses the explicitly selected harness target', async () => {
    const d = deps();
    d.liveness.isAlive.mockReturnValueOnce(true).mockReturnValueOnce(false);
    await stopAgentConfirmed(d, { target, reason: 'user.stop', revisionKey: 'r' });
    expect(d.harnessStop.stop).toHaveBeenCalledWith(target, { preserveForResume: false });
  });
  it('rejects and does not deliver when still alive', async () => {
    const d = deps();
    await expect(
      stopAgentConfirmed(d, { target, reason: 'user.stop', revisionKey: 'r' })
    ).rejects.toMatchObject({ code: 'still_alive' });
    expect(d.lifecycle.awaitExitedFact).not.toHaveBeenCalled();
  });
  it('wraps lifecycle delivery failures', async () => {
    const d = deps(false);
    d.lifecycle.awaitExitedFact.mockRejectedValue(new Error('no'));
    await expect(
      stopAgentConfirmed(d, { target, reason: 'user.stop', revisionKey: 'r' })
    ).rejects.toMatchObject({ code: 'lifecycle_delivery_failed' });
  });
  it('is idempotent for dead pids', async () => {
    const d = deps(false);
    await stopAgentConfirmed(d, { target, reason: 'user.stop', revisionKey: 'r' });
    await expect(
      stopAgentConfirmed(d, { target, reason: 'user.stop', revisionKey: 'r' })
    ).resolves.toMatchObject({ kind: 'already_stopped' });
  });
});
