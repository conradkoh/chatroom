import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('mermaid/dist/mermaid.min.js', () => ({}));

describe('getMermaidInstance', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns globalThis.mermaid when present', async () => {
    const fakeMermaid = { initialize: vi.fn(), render: vi.fn() };
    vi.stubGlobal('mermaid', fakeMermaid);
    const { getMermaidInstance } = await import('./getMermaidInstance');
    expect(getMermaidInstance()).toBe(fakeMermaid);
  });

  it('throws when mermaid global is missing', async () => {
    vi.stubGlobal('mermaid', undefined);
    const { getMermaidInstance } = await import('./getMermaidInstance');
    expect(() => getMermaidInstance()).toThrow('Mermaid failed to load');
  });
});
