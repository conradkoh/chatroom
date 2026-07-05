/**
 * Integration tests for the Pi SDK direct harness.
 *
 * Requires external services (real Pi SDK + model). NOT included in default
 * vitest runs — see vitest.config.ts exclude for `*.integration.test.ts`.
 *
 * Requirements:
 *   - Pi SDK installed with opencode/big-pickle model available
 *
 * Run: pnpm test:integration -- pi-harness.integration
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { startPiSdkHarness } from './index.js';
import type { BoundHarness } from '../../../domain/direct-harness/entities/bound-harness.js';
import { createStandardSdkChunkExtractor } from '../shared-chunk-extractor.js';

const HARNESS_CWD =
  process.env.HARNESS_CWD ?? path.resolve(fileURLToPath(import.meta.url), '../../../../../../..');

let canRun = false;

describe('Pi SDK harness integration', { timeout: 180_000 }, () => {
  let harness: BoundHarness | undefined;

  beforeAll(async () => {
    try {
      harness = await startPiSdkHarness({
        harnessName: 'pi-sdk',
        workingDir: HARNESS_CWD,
        workspaceId: 'integration-test',
        resolvedConvexUrl: 'http://test:3210',
      });
      canRun = true;
    } catch {
      canRun = false;
    }
  });

  afterAll(async () => {
    await harness?.close().catch(() => {});
  });

  it.skipIf(!canRun)('lists opencode/big-pickle', async () => {
    const providers = await harness!.listProviders();
    const opencode = providers.find((p) => p.providerID === 'opencode');
    expect(opencode?.models.some((m) => m.modelID === 'big-pickle')).toBe(true);
  });

  it.skipIf(!canRun)('runs a prompt with big-pickle', async () => {
    const session = await harness!.newSession({
      agent: 'builder',
      model: 'opencode/big-pickle',
      title: 'integration',
    });
    const extract = createStandardSdkChunkExtractor();
    const chunks: string[] = [];

    session.onEvent((event) => {
      const chunk = extract(event);
      if (chunk?.partType === 'text') chunks.push(chunk.content);
    });

    await session.prompt({
      agent: 'builder',
      model: { providerID: 'opencode', modelID: 'big-pickle' },
      parts: [{ type: 'text', text: 'Reply with exactly: pong' }],
    });

    expect(chunks.join('').length).toBeGreaterThan(0);
    await session.close();
  });
});
