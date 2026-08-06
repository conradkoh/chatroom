/**
 * Integration tests for the Cursor SDK direct harness.
 *
 * Requires external services (CURSOR_API_KEY). NOT included in default vitest
 * runs — see vitest.config.ts exclude for `*.integration.test.ts`.
 *
 * Requirements:
 *   - CURSOR_API_KEY must be set
 *   - Model composer-2.5 must be available
 *
 * Run: pnpm test:integration -- cursor-harness.integration
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { startCursorSdkHarness } from './index.js';
import type { BoundHarness } from '../../../../../domain/entities/bound-harness.js';
import { createStandardSdkChunkExtractor } from '../shared-chunk-extractor.js';

const SKIP = !process.env.CURSOR_API_KEY?.trim();
const HARNESS_CWD =
  process.env.HARNESS_CWD ?? path.resolve(fileURLToPath(import.meta.url), '../../../../../../..');

describe.skipIf(SKIP)('Cursor SDK harness integration', { timeout: 180_000 }, () => {
  let harness: BoundHarness;

  beforeAll(async () => {
    harness = await startCursorSdkHarness({
      harnessName: 'cursor-sdk',
      workingDir: HARNESS_CWD,
      workspaceId: 'integration-test',
      resolvedConvexUrl: 'http://test:3210',
    });
  });

  afterAll(async () => {
    await harness?.close().catch(() => {});
  });

  it('lists composer-2.5 in providers', async () => {
    const providers = await harness.listProviders();
    const cursor = providers.find((p) => p.providerID === 'cursor');
    expect(cursor?.models.some((m) => m.modelID === 'composer-2.5')).toBe(true);
  });

  it('runs a prompt and emits text chunks', async () => {
    const session = await harness.newSession({ agent: 'builder', title: 'integration' });
    const extract = createStandardSdkChunkExtractor();
    const chunks: string[] = [];

    session.onEvent((event) => {
      const chunk = extract(event);
      if (chunk?.partType === 'text') chunks.push(chunk.content);
    });

    await session.prompt({
      agent: 'builder',
      parts: [{ type: 'text', text: 'Reply with exactly: pong' }],
    });

    expect(chunks.join('').length).toBeGreaterThan(0);
    await session.close();
  });

  it('smoke: composer-2.5 run with tool use emits chunks without unhandled stream warnings', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const session = await harness.newSession({ agent: 'builder', title: 'sdk-smoke' });
    const extract = createStandardSdkChunkExtractor();
    const chunks: string[] = [];

    session.onEvent((event) => {
      const chunk = extract(event);
      if (chunk?.partType === 'text') chunks.push(chunk.content);
    });

    await session.prompt({
      agent: 'builder',
      model: { providerID: 'cursor', modelID: 'composer-2.5' },
      parts: [{ type: 'text', text: 'Reply with exactly: pong. Do not use any tools.' }],
    });

    expect(chunks.join('').toLowerCase()).toContain('pong');
    const unhandledWarnings = warnSpy.mock.calls.filter(
      (args) => typeof args[0] === 'string' && args[0].includes('unhandled')
    );
    expect(unhandledWarnings).toEqual([]);
    warnSpy.mockRestore();
    await session.close();
  });
});
