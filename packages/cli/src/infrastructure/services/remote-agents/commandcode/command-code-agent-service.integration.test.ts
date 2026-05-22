/**
 * Integration tests for CommandCodeAgentService.
 *
 * Spawns the real `cmd` binary using the deepseek-v4-flash model (cheapest
 * available) and verifies end-to-end spawn → stdout → exit behaviour.
 *
 * Requirements:
 *   - `cmd` CLI must be on PATH (https://commandcode.ai)
 *   - CommandCode account configured and authenticated
 *
 * The suite skips automatically when `cmd` is not found — CI does not have it
 * installed and this is expected behaviour.
 *
 * Run with:
 *   pnpm test -- --reporter=verbose command-code-agent-service.integration
 */

import { describe, it, expect, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

import { CommandCodeAgentService } from './command-code-agent-service.js';
import { createSpawnPrompt } from '../spawn-prompt.js';

// ─── Skip guard ───────────────────────────────────────────────────────────────

function cmdOnPath(): boolean {
  try {
    execSync('cmd --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const SKIP = !cmdOnPath();

// ─── Constants ────────────────────────────────────────────────────────────────

/** Hardcoded model for cost control — do NOT read from env or use a fallback. */
const MODEL = 'deepseek/deepseek-v4-flash';

const TEST_TIMEOUT_MS = 120_000;

// ─── Suite ───────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('CommandCodeAgentService integration', { timeout: TEST_TIMEOUT_MS }, () => {
  let tmpDir: string;
  const svc = new CommandCodeAgentService();
  let spawnedPid: number | null = null;

  afterAll(async () => {
    // Clean up any orphan process
    if (spawnedPid !== null) {
      try {
        await svc.stop(spawnedPid);
      } catch {
        // best-effort
      }
    }
    // Clean up temp dir
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });

  it('reports installed and returns a version', async () => {
    expect(await svc.isInstalled()).toBe(true);
    const v = await svc.getVersion();
    expect(v).not.toBeNull();
  });

  it('spawns a real cmd process with deepseek-v4-flash and receives stdout output then exits 0', async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'commandcode-integration-'));

    const result = await svc.spawn({
      workingDir: tmpDir,
      prompt: createSpawnPrompt('Reply with the single word OK and nothing else.'),
      systemPrompt: '',
      model: MODEL,
      context: { machineId: 'integration-test', chatroomId: 'integration-test', role: 'test' },
    });

    spawnedPid = result.pid;
    expect(result.pid).toBeGreaterThan(0);

    let outputCount = 0;

    const exitPromise = new Promise<{ code: number | null; signal: string | null }>(
      (resolve) => {
        result.onExit((info) => resolve(info));
      }
    );

    result.onOutput(() => {
      outputCount++;
    });

    const exitInfo = await exitPromise;

    // At least one output callback fired before exit
    expect(outputCount).toBeGreaterThan(0);
    // Process exited cleanly
    expect(exitInfo.code).toBe(0);

    // Clear so afterAll doesn't try to stop a finished process
    spawnedPid = null;
  });
});
