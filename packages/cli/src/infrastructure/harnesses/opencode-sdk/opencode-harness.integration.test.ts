/**
 * Integration tests for the OpenCode SDK direct harness.
 *
 * These tests spawn a real `opencode serve` process and exercise the full
 * harness ↔ session ↔ event-stream pipeline with a live LLM call.
 *
 * Requirements:
 *   - `opencode` CLI must be on PATH
 *   - The model "opencode-go/deepseek-v4-flash" must be reachable
 *
 * Run with:
 *   pnpm test -- --reporter=verbose opencode-harness.integration
 *
 * Or against a specific working directory:
 *   HARNESS_CWD=/path/to/project pnpm test -- opencode-harness.integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { startOpencodeSdkHarness } from './index.js';
import { opencodeSdkChunkExtractor } from './event-extractor.js';
import type { BoundHarness } from '../../../domain/direct-harness/entities/bound-harness.js';

// ─── Skip guard ───────────────────────────────────────────────────────────────

function opencodeOnPath(): boolean {
  try {
    execSync('opencode --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const SKIP = !opencodeOnPath();

// ─── Constants ────────────────────────────────────────────────────────────────

const AGENT = 'build';
const MODEL = { providerID: 'opencode-go', modelID: 'deepseek-v4-flash' };

/** Working directory for the harness — defaults to the repo root. */
const HARNESS_CWD =
  process.env.HARNESS_CWD ??
  path.resolve(fileURLToPath(import.meta.url), '../../../../../../..');

// ─── Suite ───────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('OpenCode SDK harness integration', { timeout: 120_000 }, () => {
  let harness: BoundHarness;

  beforeAll(async () => {
    harness = await startOpencodeSdkHarness({
      type: 'opencode',
      workingDir: HARNESS_CWD,
      workspaceId: 'integration-test',
    });
  });

  afterAll(async () => {
    await harness?.close().catch(() => {});
  });

  // ── Harness lifecycle ──────────────────────────────────────────────────────

  it('starts and reports isAlive()', () => {
    expect(harness.isAlive()).toBe(true);
  });

  it('lists at least one provider', async () => {
    const providers = await harness.listProviders();
    expect(providers.length).toBeGreaterThan(0);
    const ids = providers.map((p) => p.providerID);
    expect(ids).toContain('opencode-go');
  });

  it('lists at least one model under opencode-go', async () => {
    const providers = await harness.listProviders();
    const oc = providers.find((p) => p.providerID === 'opencode-go');
    expect(oc).toBeDefined();
    const modelIds = oc!.models.map((m) => m.modelID);
    expect(modelIds).toContain('deepseek-v4-flash');
  });

  it('lists agents', async () => {
    const agents = await harness.listAgents();
    // There may be zero custom agents — just confirm the call succeeds
    expect(Array.isArray(agents)).toBe(true);
  });

  // ── Session + prompt ───────────────────────────────────────────────────────

  it('opens a session, receives text events, and returns a response', async () => {
    const session = await harness.newSession({ agent: AGENT });

    const chunks: string[] = [];
    const eventTypes: string[] = [];
    let promptSent = false;

    const done = new Promise<void>((resolve) => {
      const unsub = session.onEvent((event) => {
        eventTypes.push(event.type);

        const text = opencodeSdkChunkExtractor(event);
        if (text) chunks.push(text);

        // Only treat session.idle/ready as "done" after the prompt has been
        // sent — the initial session.idle fires before any prompt and would
        // resolve the promise prematurely otherwise.
        if (
          promptSent &&
          (event.type === 'session.idle' || event.type === 'session.ready')
        ) {
          unsub();
          resolve();
        }
      });

      // Safety net — resolve after 90 s regardless
      setTimeout(() => {
        unsub();
        resolve();
      }, 90_000);
    });

    // Set promptSent BEFORE the call so any idle/ready event emitted during
    // the await (i.e. after the LLM finishes) is correctly treated as post-prompt.
    promptSent = true;
    await session.prompt({
      parts: [{ type: 'text', text: 'Reply with exactly three words.' }],
      agent: AGENT,
      model: MODEL,
    });

    await done;

    console.log('[integration] events received:', eventTypes);
    const full = chunks.join('');
    console.log('[integration] LLM response:', full.slice(0, 200));
    expect(full.length).toBeGreaterThan(0);

    await session.close();
  });

  it('can open two sessions independently on the same harness', async () => {
    const [s1, s2] = await Promise.all([
      harness.newSession({ agent: AGENT }),
      harness.newSession({ agent: AGENT }),
    ]);

    expect(s1.opencodeSessionId).not.toBe(s2.opencodeSessionId);

    await Promise.all([s1.close(), s2.close()]);
  });
});
