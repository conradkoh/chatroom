import { describe, expect, it, vi } from 'vitest';

import { HARNESS_MODEL_CATALOG } from '@workspace/backend/src/domain/entities/harness/model-catalog.js';
import { decodeModelVariant } from '@workspace/backend/src/domain/entities/harness/model-variant.js';

import { ClaudeSdkHarness } from './claude-harness.js';

vi.mock('../../services/claude-sdk/claude-sdk-package.js', () => ({
  importBundledClaudeSdk: vi.fn(async () => ({ query: vi.fn() })),
  formatClaudeSdkLoadError: (err: unknown) => String(err),
  resolvePathToClaudeCodeExecutable: vi.fn(async () => '/bin/claude'),
}));

describe('ClaudeSdkHarness.listProviders', () => {
  it('lists anthropic models from server catalog without duplicate base ids', async () => {
    const harness = new ClaudeSdkHarness('/tmp/work', { query: vi.fn() } as never, '/bin/claude');
    const providers = await harness.listProviders();
    const anthropic = providers.find((p) => p.providerID === 'anthropic');
    expect(anthropic).toBeDefined();
    const modelIds = anthropic!.models.map((m) => m.modelID);
    expect(modelIds).toEqual([...HARNESS_MODEL_CATALOG['claude-sdk']]);
    const baseIds = modelIds.map((id) => decodeModelVariant(id).model);
    expect(new Set(baseIds).size).toBe(4);
    expect(baseIds).not.toContain('sonnet');
    expect(baseIds).not.toContain('haiku');
    expect(baseIds).not.toContain('opus');
  });
});
