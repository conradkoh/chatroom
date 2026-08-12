/**
 * Model refresh — server catalog fetch + overlay.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyCatalogOverlay, fetchHarnessCatalog } from './models-refresh.js';

const SESSION_ID = 'session-1';

/**
 * Client stub returning one canned result per call, in catalog order
 * (codex-sdk, copilot, cursor, claude, claude-sdk). An Error entry rejects that call.
 */
function clientWith(sequence: (string[] | Error)[]) {
  const query = vi.fn();
  for (const result of sequence) {
    if (result instanceof Error) {
      query.mockRejectedValueOnce(result);
    } else {
      query.mockResolvedValueOnce(result);
    }
  }
  return { query };
}

describe('fetchHarnessCatalog', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  it('fetches one list per catalog-backed harness, concurrently', async () => {
    const client = clientWith([
      ['gpt-5.6-terra', 'gpt-5.6-terra[reasoning=high]'],
      ['claude-sonnet-4-6'],
      ['auto', 'composer-2.5'],
      ['claude-sonnet-4-6', 'claude-sonnet-4-6[effort=high]'],
      ['claude-sonnet-4-6', 'claude-sonnet-4-6[effort=high]'],
    ]);

    const catalog = await fetchHarnessCatalog(client, SESSION_ID);

    expect(catalog).toEqual({
      'codex-sdk': ['gpt-5.6-terra', 'gpt-5.6-terra[reasoning=high]'],
      copilot: ['claude-sonnet-4-6'],
      cursor: ['auto', 'composer-2.5'],
      claude: ['claude-sonnet-4-6', 'claude-sonnet-4-6[effort=high]'],
      'claude-sdk': ['claude-sonnet-4-6', 'claude-sonnet-4-6[effort=high]'],
    });
    expect(client.query).toHaveBeenCalledTimes(5);
    for (const call of client.query.mock.calls) {
      expect(call[1]).toEqual({ sessionId: SESSION_ID });
    }
  });

  it('skips a harness whose query fails, keeping the others', async () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = clientWith([['gpt-5.6-terra'], new Error('backend down'), ['auto']]);

    const catalog = await fetchHarnessCatalog(client, SESSION_ID);

    expect(catalog).toEqual({ 'codex-sdk': ['gpt-5.6-terra'], cursor: ['auto'] });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('copilot'));
  });
});

describe('applyCatalogOverlay', () => {
  it('replaces local discovery for catalog-backed harnesses, leaves others untouched', () => {
    const discovered: Record<string, string[]> = {
      'codex-sdk': [],
      copilot: [],
      'pi-sdk': ['local-model'],
    };

    applyCatalogOverlay(discovered, {
      'codex-sdk': ['gpt-5.6-terra'],
      copilot: ['claude-sonnet-4-6'],
    });

    expect(discovered).toEqual({
      'codex-sdk': ['gpt-5.6-terra'],
      copilot: ['claude-sonnet-4-6'],
      'pi-sdk': ['local-model'],
    });
  });
});
