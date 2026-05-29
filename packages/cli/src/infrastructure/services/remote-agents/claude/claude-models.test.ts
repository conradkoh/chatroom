import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLAUDE_FALLBACK_MODELS, fetchClaudeModels } from './claude-models.js';

describe('CLAUDE_FALLBACK_MODELS', () => {
  it('includes claude-opus-4-8, aliases, and previous pinned models', () => {
    expect(CLAUDE_FALLBACK_MODELS).toContain('claude-opus-4-8');
    expect(CLAUDE_FALLBACK_MODELS).toContain('opus');
    expect(CLAUDE_FALLBACK_MODELS).toContain('sonnet');
    expect(CLAUDE_FALLBACK_MODELS).toContain('haiku');
    expect(CLAUDE_FALLBACK_MODELS).toContain('claude-opus-4-6');
    expect(CLAUDE_FALLBACK_MODELS).toContain('claude-sonnet-4-6');
    expect(CLAUDE_FALLBACK_MODELS).toContain('claude-haiku-4-5');
  });
});

describe('fetchClaudeModels', () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
    globalThis.fetch = originalFetch;
  });

  it('returns undefined when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await fetchClaudeModels()).toBeUndefined();
  });

  it('returns undefined when ANTHROPIC_API_KEY is empty', async () => {
    process.env.ANTHROPIC_API_KEY = '   ';
    expect(await fetchClaudeModels()).toBeUndefined();
  });

  it('returns filtered claude models when API call succeeds', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'claude-opus-4-8' },
          { id: 'claude-sonnet-4-6' },
          { id: 'gpt-4' },
        ],
      }),
    });

    const models = await fetchClaudeModels();
    expect(models).toEqual(['claude-opus-4-8', 'claude-sonnet-4-6']);
    expect(globalThis.fetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': 'test-key',
        'anthropic-version': '2023-06-01',
      },
    });
  });

  it('returns undefined on non-OK API response', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });

    expect(await fetchClaudeModels()).toBeUndefined();
  });

  it('returns undefined when API returns no claude-* models', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gpt-4' }] }),
    });

    expect(await fetchClaudeModels()).toBeUndefined();
  });

  it('returns undefined on fetch exception', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    expect(await fetchClaudeModels()).toBeUndefined();
  });
});
