/**
 * Integration tests for PiAgentService with opencode/big-pickle.
 *
 * Requires external services (real `pi` CLI + model). NOT included in default
 * vitest runs — see vitest.config.ts exclude for `*.integration.test.ts`.
 *
 * Requirements:
 *   - `pi` CLI on PATH
 *   - Model `opencode/big-pickle` available via `pi --list-models`
 *
 * Note: big-pickle is a thinking model — a single turn may take up to ~2 minutes
 * when tool calls or extended reasoning are involved. Timeouts are set accordingly.
 *
 * Run:
 *   pnpm test:integration -- --reporter=verbose pi-agent-service.integration
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { PiAgentService } from './pi-agent-service.js';
import { createSpawnPrompt } from '../spawn-prompt.js';

const MODEL = 'opencode/big-pickle';
const TEST_TIMEOUT_MS = 180_000;

function piOnPath(): boolean {
  try {
    execSync('pi --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function modelAvailable(): boolean {
  try {
    const out = execSync('pi --list-models 2>&1', { stdio: 'pipe' }).toString();
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
      const cols = trimmed.split(/\s+/);
      if (cols[0] === 'provider') continue;
      if (cols.length >= 2 && `${cols[0]}/${cols[1]}` === MODEL) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

const SKIP = !piOnPath() || !modelAvailable();

describe.skipIf(SKIP)('PiAgentService integration', { timeout: TEST_TIMEOUT_MS }, () => {
  let tmpDir: string;
  const svc = new PiAgentService();
  let spawnedPid: number | null = null;

  afterAll(async () => {
    if (spawnedPid !== null) {
      try {
        await svc.stop(spawnedPid);
      } catch {
        // best-effort
      }
    }
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });

  it('spawns pi RPC with opencode/big-pickle and receives output', async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pi-integration-'));

    const result = await svc.spawn({
      workingDir: tmpDir,
      prompt: createSpawnPrompt('Reply with exactly the word PICKLE and nothing else.'),
      systemPrompt: '',
      model: MODEL,
      context: {
        machineId: 'integration-test',
        chatroomId: 'integration-test-room',
        role: 'builder',
      },
      resolvedConvexUrl: 'http://test:3210',
    });

    spawnedPid = result.pid;
    expect(result.pid).toBeGreaterThan(0);

    let outputCount = 0;
    const outputLines: string[] = [];
    result.onOutput(() => {
      outputCount += 1;
    });
    result.onLogLine?.((line) => outputLines.push(line));

    if (!result.onAgentEnd) {
      throw new Error('onAgentEnd callback missing from spawn result');
    }
    const onAgentEnd = result.onAgentEnd;

    const agentEndPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(`Pi agent_end timeout. Recent log lines:\n${outputLines.slice(-20).join('\n')}`)
        );
      }, TEST_TIMEOUT_MS - 10_000);

      onAgentEnd(() => {
        clearTimeout(timeout);
        resolve();
      });
    });

    await agentEndPromise;
    expect(outputCount).toBeGreaterThan(0);
    expect(svc.isAlive(result.pid)).toBe(true);

    await svc.stop(result.pid);
    spawnedPid = null;
  });
});
