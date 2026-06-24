/**
 * Integration tests for OpenCodeSdkAgentService native idle-spawn + injection flow.
 *
 * Validates deferInitialTurn (no prompt on spawn) → resumeTurn (injected task) → agent_end.
 * Uses opencode/big-pickle on the opencode provider (cheap thinking model on local opencode).
 *
 * Requirements:
 *   - `opencode` CLI on PATH
 *   - Model `opencode/big-pickle` reachable
 *
 * Run:
 *   pnpm --filter chatroom-cli test -- --reporter=verbose opencode-sdk-native-flow.integration
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { OpenCodeSdkAgentService } from './opencode-sdk-agent-service.js';
import { FileSessionMetadataStore } from './session-metadata-store.js';
import { createSpawnPrompt } from '../spawn-prompt.js';

const MODEL = 'opencode/big-pickle';
const TEST_TIMEOUT_MS = 180_000;

function opencodeOnPath(): boolean {
  try {
    execSync('opencode --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function modelAvailable(): boolean {
  try {
    const out = execSync('opencode models', { stdio: 'pipe' }).toString();
    return out.split('\n').some((line) => line.trim() === MODEL);
  } catch {
    return false;
  }
}

const SKIP = !opencodeOnPath() || !modelAvailable();

describe.skipIf(SKIP)(
  'OpenCodeSdkAgentService native flow integration',
  { timeout: TEST_TIMEOUT_MS },
  () => {
    let tmpDir: string;
    const sessionStorePath = path.join(
      os.tmpdir(),
      `opencode-sdk-native-${process.pid}-${Date.now()}.json`
    );
    const sessionStore = new FileSessionMetadataStore(sessionStorePath);
    const svc = new OpenCodeSdkAgentService({ sessionMetadataStore: sessionStore });
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
      try {
        fs.rmSync(sessionStorePath, { force: true });
      } catch {
        // best-effort
      }
    });

    it('deferInitialTurn spawns idle (no initial prompt), resumeTurn completes turn with big-pickle', async () => {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencode-sdk-native-'));

      const bootstrap = createSpawnPrompt('', { nativeBootstrap: true });
      expect(bootstrap.toLowerCase()).toMatch(/focus on your role/);

      const logLines: string[] = [];
      let agentEndCount = 0;

      const result = await svc.spawn({
        workingDir: tmpDir,
        prompt: bootstrap,
        systemPrompt: 'You are a test agent. Follow instructions exactly.',
        model: MODEL,
        deferInitialTurn: true,
        context: {
          machineId: 'integration-test',
          chatroomId: 'integration-test-room',
          role: 'planner',
        },
        resolvedConvexUrl: 'http://test:3210',
      });

      spawnedPid = result.pid;
      expect(result.pid).toBeGreaterThan(0);
      expect(result.harnessReconnect).toEqual(
        expect.objectContaining({ agentName: 'build', model: MODEL })
      );

      result.onLogLine?.((line) => logLines.push(line));

      if (!result.onAgentEnd) {
        throw new Error('onAgentEnd callback missing from spawn result');
      }
      const onAgentEnd = result.onAgentEnd;

      const agentEndPromise = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(
            new Error(
              `opencode-sdk agent_end never fired within timeout. Recent log lines:\n${logLines.slice(-20).join('\n')}`
            )
          );
        }, TEST_TIMEOUT_MS - 10_000);

        onAgentEnd(() => {
          agentEndCount += 1;
          clearTimeout(timeout);
          resolve();
        });
      });

      await svc.resumeTurn(
        result.pid,
        'Reply with exactly the word PICKLE and nothing else. No tools.'
      );

      await agentEndPromise;
      expect(agentEndCount).toBeGreaterThanOrEqual(1);
      expect(svc.isAlive(result.pid)).toBe(true);

      spawnedPid = null;
      await svc.stop(result.pid);
    });
  }
);
