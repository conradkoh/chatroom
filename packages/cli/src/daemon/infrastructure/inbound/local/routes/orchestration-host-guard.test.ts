// fallow-ignore-file code-duplication
import type { ServerResponse } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { assertChatroomHostedLocally } from './orchestration-host-guard.js';

const P8 = 'DAEMON_ORCHESTRATION_P8';

function makeRes(): { res: ServerResponse; captured: { status: number; json: unknown } } {
  const captured: { status: number; json: unknown } = { status: 0, json: undefined };
  const res = {
    writeHead(code: number) {
      captured.status = code;
    },
    end(text: string) {
      captured.json = JSON.parse(text);
    },
  } as unknown as ServerResponse;
  return { res, captured };
}

describe('assertChatroomHostedLocally (P8)', () => {
  afterEach(() => {
    delete process.env[P8];
    vi.restoreAllMocks();
  });

  it('accepts when P8 flag is off (unchanged behavior)', async () => {
    const deps = {
      machineId: 'machine-a',
      queryChatroomOrchestrationHost: vi.fn().mockResolvedValue({
        machineId: 'machine-b',
        workingDir: '/ws',
      }),
    };
    const { res, captured } = makeRes();
    const ok = await assertChatroomHostedLocally(deps, 'room-1', res);
    expect(ok).toBe(true);
    expect(captured.status).toBe(0);
  });

  it('accepts when chatroom has no orchestration host bound', async () => {
    process.env[P8] = '1';
    const deps = {
      machineId: 'machine-a',
      queryChatroomOrchestrationHost: vi.fn().mockResolvedValue(null),
    };
    const { res, captured } = makeRes();
    const ok = await assertChatroomHostedLocally(deps, 'room-1', res);
    expect(ok).toBe(true);
    expect(captured.status).toBe(0);
  });

  it('accepts when local machine hosts the chatroom', async () => {
    process.env[P8] = '1';
    const deps = {
      machineId: 'machine-a',
      queryChatroomOrchestrationHost: vi.fn().mockResolvedValue({
        machineId: 'machine-a',
        workingDir: '/ws',
      }),
    };
    const { res, captured } = makeRes();
    const ok = await assertChatroomHostedLocally(deps, 'room-1', res);
    expect(ok).toBe(true);
    expect(captured.status).toBe(0);
  });

  it('rejects with 403 chatroom_not_hosted when another machine hosts the chatroom', async () => {
    process.env[P8] = '1';
    const deps = {
      machineId: 'machine-a',
      queryChatroomOrchestrationHost: vi.fn().mockResolvedValue({
        machineId: 'machine-b',
        workingDir: '/ws',
      }),
    };
    const { res, captured } = makeRes();
    const ok = await assertChatroomHostedLocally(deps, 'room-1', res);
    expect(ok).toBe(false);
    expect(captured.status).toBe(403);
    expect(captured.json).toMatchObject({
      success: false,
      error: { code: 'chatroom_not_hosted' },
    });
  });
});
