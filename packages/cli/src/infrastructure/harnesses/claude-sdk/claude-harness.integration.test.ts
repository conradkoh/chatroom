/**
 * Integration tests for the Claude SDK direct harness.
 *
 * Requires external services (ANTHROPIC_API_KEY and bundled Claude Code executable).
 * NOT included in default vitest runs — see vitest.config.ts exclude for
 * `*.integration.test.ts`.
 *
 * Run: pnpm test:integration -- claude-harness.integration
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { startClaudeSdkHarness } from './index.js';
import type { BoundHarness } from '../../../domain/direct-harness/entities/bound-harness.js';
import { createStandardSdkChunkExtractor } from '../shared-chunk-extractor.js';

const SKIP = !process.env.ANTHROPIC_API_KEY?.trim();
const HARNESS_CWD =
  process.env.HARNESS_CWD ?? path.resolve(fileURLToPath(import.meta.url), '../../../../../../..');

describe.skipIf(SKIP)('Claude SDK harness integration', { timeout: 180_000 }, () => {
  let harness: BoundHarness;

  beforeAll(async () => {
    harness = await startClaudeSdkHarness({
      harnessName: 'claude-sdk',
      workingDir: HARNESS_CWD,
      workspaceId: 'integration-test',
      resolvedConvexUrl: 'http://test:3210',
    });
  });

  afterAll(async () => {
    await harness?.close().catch(() => {});
  });

  it('lists anthropic provider models', async () => {
    const providers = await harness.listProviders();
    const anthropic = providers.find((p) => p.providerID === 'anthropic');
    expect(anthropic?.models.length).toBeGreaterThan(0);
  });

  it('runs a prompt and emits text chunks', async () => {
    const session = await harness.newSession({ agent: 'builder', title: 'integration' });
    const extract = createStandardSdkChunkExtractor();
    const chunks: string[] = [];
    let idle = false;

    session.onEvent((event) => {
      const chunk = extract(event);
      if (chunk?.partType === 'text') chunks.push(chunk.content);
      if (event.type === 'session.idle') idle = true;
    });

    await session.prompt({
      agent: 'builder',
      parts: [{ type: 'text', text: 'Reply with exactly: pong' }],
    });

    expect(chunks.join('').length).toBeGreaterThan(0);
    expect(idle).toBe(true);
    await session.close();
  });
});
