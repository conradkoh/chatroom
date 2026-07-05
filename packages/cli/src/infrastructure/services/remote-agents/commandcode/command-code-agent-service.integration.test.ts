/**
 * Integration tests for CommandCodeAgentService.
 *
 * Requires external services (real `cmd` CLI + account). NOT included in default
 * vitest runs — see vitest.config.ts exclude for `*.integration.test.ts`.
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
 *   pnpm test:integration -- --reporter=verbose command-code-agent-service.integration
 */

import { execSync, spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, afterAll } from 'vitest';

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
      resolvedConvexUrl: 'http://test:3210',
    });

    spawnedPid = result.pid;
    expect(result.pid).toBeGreaterThan(0);

    let outputCount = 0;

    const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      result.onExit((info) => resolve(info));
    });

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

// ─── Diagnostic suite ─────────────────────────────────────────────────────────

const DIAG_PROMPT = 'Reply with the single word OK and nothing else.';
const DIAG_TIMEOUT_MS = 90_000;

interface DiagResult {
  stdoutBytes: number;
  stdoutChunks: number;
  stdoutText: string;
  stderrBytes: number;
  stderrText: string;
  exitCode: number | null;
  signal: string | null;
  timeToFirstStdoutByteMs: number | null;
  totalDurationMs: number;
  error?: string;
}

function runVariant(
  label: string,
  command: string,
  args: string[],
  options: {
    stdio: ('pipe' | 'ignore')[];
    stdinPayload?: string;
  },
  timeoutMs: number
): Promise<DiagResult> {
  return new Promise((resolve) => {
    const startMs = Date.now();
    let timeToFirstStdoutByteMs: number | null = null;
    let stdoutBytes = 0;
    let stdoutChunks = 0;
    let stdoutText = '';
    let stderrBytes = 0;
    let stderrText = '';

    let child: ReturnType<typeof nodeSpawn>;
    try {
      child = nodeSpawn(command, args, {
        stdio: options.stdio as any,
        shell: false,
      });
    } catch (err) {
      resolve({
        stdoutBytes: 0,
        stdoutChunks: 0,
        stdoutText: '',
        stderrBytes: 0,
        stderrText: '',
        exitCode: null,
        signal: null,
        timeToFirstStdoutByteMs: null,
        totalDurationMs: Date.now() - startMs,
        error: String(err),
      });
      return;
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      resolve({
        stdoutBytes,
        stdoutChunks,
        stdoutText,
        stderrBytes,
        stderrText,
        exitCode: null,
        signal: 'TIMEOUT',
        timeToFirstStdoutByteMs,
        totalDurationMs: Date.now() - startMs,
        error: `timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.on('data', (chunk: Buffer) => {
        if (timeToFirstStdoutByteMs === null) {
          timeToFirstStdoutByteMs = Date.now() - startMs;
        }
        stdoutBytes += chunk.length;
        stdoutChunks++;
        stdoutText += chunk.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        stderrText += chunk.toString();
      });
    }

    if (options.stdinPayload !== undefined && child.stdin) {
      child.stdin.write(options.stdinPayload);
      child.stdin.end();
    }

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdoutBytes,
        stdoutChunks,
        stdoutText,
        stderrBytes,
        stderrText,
        exitCode: null,
        signal: null,
        timeToFirstStdoutByteMs,
        totalDurationMs: Date.now() - startMs,
        error: String(err),
      });
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({
        stdoutBytes,
        stdoutChunks,
        stdoutText,
        stderrBytes,
        stderrText,
        exitCode: code,
        signal: signal ?? null,
        timeToFirstStdoutByteMs,
        totalDurationMs: Date.now() - startMs,
      });
    });
  });
}

describe.skipIf(SKIP)(
  'cmd invocation diagnostics',
  { timeout: DIAG_TIMEOUT_MS * 3 + 30_000 },
  () => {
    it('collects stdout/stderr data for three invocation variants', async () => {
      const results: Record<string, DiagResult> = {};

      // ── Variant 1: stdin-piped (current harness form) ──────────────────────
      results['stdin-piped'] = await runVariant(
        'stdin-piped',
        'cmd',
        ['-p', '--skip-onboarding', '--yolo', '--model', MODEL],
        { stdio: ['pipe', 'pipe', 'pipe'], stdinPayload: DIAG_PROMPT },
        DIAG_TIMEOUT_MS
      );

      // ── Variant 2: positional prompt ───────────────────────────────────────
      results['positional'] = await runVariant(
        'positional',
        'cmd',
        ['-p', DIAG_PROMPT, '--skip-onboarding', '--yolo', '--model', MODEL],
        { stdio: ['ignore', 'pipe', 'pipe'] },
        DIAG_TIMEOUT_MS
      );

      // ── Variant 3: echo-piped via shell ────────────────────────────────────
      // Matches https://commandcode.ai/docs/core-concepts/headless "Piped Stdin"
      const safePrompt = DIAG_PROMPT.replace(/'/g, "'\\''");
      results['echo-piped'] = await runVariant(
        'echo-piped',
        'sh',
        ['-c', `echo '${safePrompt}' | cmd -p --skip-onboarding --yolo --model ${MODEL}`],
        { stdio: ['ignore', 'pipe', 'pipe'] },
        DIAG_TIMEOUT_MS
      );

      // ── Log structured summary ─────────────────────────────────────────────
      for (const [label, r] of Object.entries(results)) {
        const ttfb = r.timeToFirstStdoutByteMs !== null ? `${r.timeToFirstStdoutByteMs}ms` : 'none';
        const exitStr = r.signal === 'TIMEOUT' ? 'TIMEOUT' : `${r.exitCode}`;
        const errStr = r.error ? ` err=${r.error.slice(0, 80)}` : '';
        console.info(
          `[diagnostic] ${label.padEnd(14)}: stdout=${r.stdoutBytes}B in ${r.stdoutChunks} chunks, ttfb=${ttfb}, exit=${exitStr}, stderr=${r.stderrBytes}B${errStr}`
        );
        if (r.stdoutText) {
          console.info(
            `[diagnostic] ${label.padEnd(14)}: stdout_preview=${r.stdoutText.slice(0, 200).replace(/\n/g, '\\n')}`
          );
        }
        if (r.stderrText) {
          console.info(
            `[diagnostic] ${label.padEnd(14)}: stderr_preview=${r.stderrText.slice(0, 200).replace(/\n/g, '\\n')}`
          );
        }
      }

      // No strict assertions — this test is data-gathering only.
      // The test always "passes" so we see the diagnostic output.
      expect(Object.keys(results)).toHaveLength(3);
    });
  }
);
