/**
 * Integration tests for the Cursor SDK direct harness.
 *
 * Requirements:
 *   - CURSOR_API_KEY must be set
 *   - Model composer-2.5 must be available
 *
 * Run: pnpm test -- cursor-harness.integration
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { startCursorSdkHarness } from './index.js';
import type { BoundHarness } from '../../../domain/direct-harness/entities/bound-harness.js';
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
});
