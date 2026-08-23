import { afterEach, describe, expect, it, vi } from 'vitest';

const fakeMermaid = { initialize: vi.fn(), render: vi.fn() };

vi.mock('mermaid/dist/mermaid.min.js', () => ({}));

describe('loadMermaidInstance', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('returns globalThis.mermaid after dynamic import', async () => {
    vi.stubGlobal('mermaid', fakeMermaid);
    const { loadMermaidInstance } = await import('./getMermaidInstance');
    const instance = await loadMermaidInstance();
    expect(instance).toBe(fakeMermaid);
    const again = await loadMermaidInstance();
    expect(again).toBe(fakeMermaid);
  });

  it('throws when mermaid global is missing after import', async () => {
    vi.stubGlobal('mermaid', undefined);
    const { loadMermaidInstance } = await import('./getMermaidInstance');
    await expect(loadMermaidInstance()).rejects.toThrow('Mermaid failed to load');
  });
});
