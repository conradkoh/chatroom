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

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createOpencodeSdkChunkExtractor } from './event-extractor.js';
import { startOpencodeSdkHarness } from './index.js';
import type { OpencodeSdkHarness } from './opencode-harness.js';
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
  process.env.HARNESS_CWD ?? path.resolve(fileURLToPath(import.meta.url), '../../../../../../..');

// ─── Suite ───────────────────────────────────────────────────────────────────

describe.skipIf(SKIP)('OpenCode SDK harness integration', { timeout: 120_000 }, () => {
  let harness: BoundHarness;

  beforeAll(async () => {
    harness = await startOpencodeSdkHarness({
      type: 'opencode',
      workingDir: HARNESS_CWD,
      workspaceId: 'integration-test',
      resolvedConvexUrl: 'http://test:3210',
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
    if (!oc) throw new Error('expected opencode-go provider');
    const modelIds = oc.models.map((m) => m.modelID);
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
    const extractChunk = createOpencodeSdkChunkExtractor();

    const done = new Promise<void>((resolve) => {
      const unsub = session.onEvent((event) => {
        eventTypes.push(event.type);

        const extracted = extractChunk(event);
        if (extracted) chunks.push(extracted.content);

        // Only treat session.idle/ready as "done" after the prompt has been
        // sent — the initial session.idle fires before any prompt and would
        // resolve the promise prematurely otherwise.
        if (promptSent && (event.type === 'session.idle' || event.type === 'session.ready')) {
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

  // ── SSE subscribe-count regression (Phase 2 repro) ────────────────────────────
  // Tests #1 and #2 are expected to FAIL on current code — they pin the bug.
  // Test #3 should pass on current code.

  it('opens exactly one event.subscribe call across the harness lifetime, even with 2 sessions', async () => {
    const h = harness as OpencodeSdkHarness;
    const subscribeBefore = h._debugSubscribeCount();

    const [s1, s2] = await Promise.all([
      harness.newSession({ agent: AGENT }),
      harness.newSession({ agent: AGENT }),
    ]);

    // Attach listeners (triggers per-session SSE loops in current code)
    const makeSessionDone = (session: Awaited<ReturnType<typeof harness.newSession>>) => {
      return new Promise<void>((resolve) => {
        let promptSent = false;
        const unsub = session.onEvent((ev) => {
          if (promptSent && (ev.type === 'session.idle' || ev.type === 'session.ready')) {
            unsub();
            resolve();
          }
        });
        const timeout = setTimeout(() => {
          unsub();
          resolve();
        }, 60_000);
        promptSent = true;
        void session
          .prompt({
            parts: [{ type: 'text', text: 'Say "ok" and nothing else.' }],
            agent: AGENT,
            model: MODEL,
          })
          .catch(() => {
            clearTimeout(timeout);
            resolve();
          });
      });
    };

    await Promise.all([makeSessionDone(s1), makeSessionDone(s2)]);
    await Promise.all([s1.close(), s2.close()]);

    const subscribeCallsForTest = h._debugSubscribeCount() - subscribeBefore;
    console.log(`[repro-test-1] subscribe calls during test: ${subscribeCallsForTest}`);

    // EXPECTED TO FAIL on current code: current code opens ≥3 subscribe calls
    // (1 harness-level + 1 per session × 2 = 3).
    expect(subscribeCallsForTest).toBe(1);
  });

  it('streams text deltas via SSE only — no events arrive after session.idle', async () => {
    const session = await harness.newSession({ agent: AGENT });

    const deltaEventsWithTimestamp: { type: string; ts: number }[] = [];
    let firstIdleTs: number | null = null;

    const done = new Promise<void>((resolve) => {
      let promptSent = false;
      const unsub = session.onEvent((ev) => {
        const ts = Date.now();

        if (ev.type === 'message.part.delta' || ev.type === 'message.part.updated') {
          deltaEventsWithTimestamp.push({ type: ev.type, ts });
        }

        if (ev.type === 'session.idle' || ev.type === 'session.ready') {
          if (firstIdleTs === null) firstIdleTs = ts;
        }

        if (promptSent && (ev.type === 'session.idle' || ev.type === 'session.ready')) {
          unsub();
          resolve();
        }
      });
      const timeout = setTimeout(() => {
        unsub();
        resolve();
      }, 60_000);
      promptSent = true;
      void session
        .prompt({
          parts: [{ type: 'text', text: 'Reply with exactly three words.' }],
          agent: AGENT,
          model: MODEL,
        })
        .catch(() => {
          clearTimeout(timeout);
          resolve();
        });
    });

    await done;

    // Wait 2 seconds past idle to let any stray events arrive
    await new Promise<void>((r) => setTimeout(r, 2_000));

    await session.close();

    console.log(
      `[repro-test-2] firstIdleTs=${firstIdleTs} deltaEvents=${deltaEventsWithTimestamp.length}`
    );

    // Must have received at least some streaming events
    expect(deltaEventsWithTimestamp.length).toBeGreaterThan(0);

    // EXPECTED TO FAIL on current code: duplicate SSE streams deliver delta events
    // after session.idle due to interleaved delivery from two independent subscribers.
    const lateEvents = deltaEventsWithTimestamp.filter(
      (e) => firstIdleTs !== null && e.ts > firstIdleTs
    );
    console.log(`[repro-test-2] late delta events after idle: ${lateEvents.length}`);
    expect(lateEvents).toHaveLength(0);
  });

  it('aggregated text from streamed chunks matches a non-empty response', async () => {
    const session = await harness.newSession({ agent: AGENT });

    const chunksByMessage = new Map<string, string[]>();
    const extractChunk = createOpencodeSdkChunkExtractor();

    const done = new Promise<void>((resolve) => {
      let promptSent = false;
      const unsub = session.onEvent((ev) => {
        const extracted = extractChunk(ev);
        if (extracted) {
          const existing = chunksByMessage.get(extracted.messageId) ?? [];
          existing.push(extracted.content);
          chunksByMessage.set(extracted.messageId, existing);
        }
        if (promptSent && (ev.type === 'session.idle' || ev.type === 'session.ready')) {
          unsub();
          resolve();
        }
      });
      const timeout = setTimeout(() => {
        unsub();
        resolve();
      }, 60_000);
      promptSent = true;
      void session
        .prompt({
          parts: [{ type: 'text', text: 'Reply with exactly three words.' }],
          agent: AGENT,
          model: MODEL,
        })
        .catch(() => {
          clearTimeout(timeout);
          resolve();
        });
    });

    await done;
    await session.close();

    const allTexts = [...chunksByMessage.values()].map((chunks) => chunks.join(''));
    const combinedText = allTexts.join('');

    console.log(`[repro-test-3] aggregated text (first 200 chars): ${combinedText.slice(0, 200)}`);

    // EXPECTED TO PASS on current code
    expect(combinedText.length).toBeGreaterThan(0);
    expect(/[a-zA-Z]/.test(combinedText)).toBe(true);
  });

  // ── Phase 6: idle → finalize ordering ─────────────────────────────────────
  //
  // Verifies the constraint: no delta/content events arrive AFTER session.idle.
  // This is a harness-only ordering test.
  //
  // A full backend-integrated e2e (turn becomes status='complete' with
  // concatenated content) requires a live Convex backend and auth context,
  // which is out of scope for this file. The idle-handler unit tests
  // (idle-handler.test.ts) cover the finalizeAssistantTurn call path.

  it('session.idle arrives exactly once, and no delta events arrive after it', async () => {
    const session = await harness.newSession({ agent: AGENT });

    const deltaTimestamps: number[] = [];
    let firstIdleTs: number | null = null;
    let idleCount = 0;

    const done = new Promise<void>((resolve) => {
      let promptSent = false;
      const unsub = session.onEvent((ev) => {
        const ts = Date.now();

        if (ev.type === 'message.part.delta' || ev.type === 'message.part.updated') {
          deltaTimestamps.push(ts);
        }

        if (ev.type === 'session.idle') {
          idleCount++;
          if (firstIdleTs === null) firstIdleTs = ts;
        }

        if (promptSent && (ev.type === 'session.idle' || ev.type === 'session.ready')) {
          unsub();
          resolve();
        }
      });
      const timeout = setTimeout(() => {
        unsub();
        resolve();
      }, 60_000);
      promptSent = true;
      void session
        .prompt({
          parts: [{ type: 'text', text: 'Reply with exactly three words.' }],
          agent: AGENT,
          model: MODEL,
        })
        .catch(() => {
          clearTimeout(timeout);
          resolve();
        });
    });

    await done;
    // Wait 1s past idle to let any stray events arrive
    await new Promise<void>((r) => setTimeout(r, 1_000));
    await session.close();

    console.log(
      `[phase6] idleCount=${idleCount} deltaEvents=${deltaTimestamps.length} firstIdleTs=${firstIdleTs}`
    );

    // Must have received at least one streaming event
    expect(deltaTimestamps.length).toBeGreaterThan(0);

    // session.idle must have fired exactly once (single-subscriber, no duplicates)
    expect(idleCount).toBe(1);

    // Ordering guarantee: all delta events precede session.idle
    const lateDeltas = deltaTimestamps.filter((ts) => firstIdleTs !== null && ts > firstIdleTs);
    console.log(`[phase6] late delta events after idle: ${lateDeltas.length}`);
    expect(lateDeltas).toHaveLength(0);
  });
});
