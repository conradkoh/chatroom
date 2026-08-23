import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakeMermaid = { initialize: vi.fn(), render: vi.fn() };

vi.mock('mermaid/dist/mermaid.min.js?url', () => ({
  default: '/fake/mermaid.min.js',
}));

describe('loadMermaidInstance', () => {
  beforeEach(() => {
    vi.stubGlobal('mermaid', undefined);
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    document.querySelectorAll('script[data-mermaid-loader]').forEach((el) => el.remove());
  });

  it('returns globalThis.mermaid after script load', async () => {
    const { loadMermaidInstance } = await import('./getMermaidInstance');
    const promise = loadMermaidInstance();

    const script = document.querySelector<HTMLScriptElement>('script[data-mermaid-loader]');
    expect(script?.src).toContain('mermaid.min.js');

    vi.stubGlobal('mermaid', fakeMermaid);
    script?.onload?.(new Event('load'));

    const instance = await promise;
    expect(instance).toBe(fakeMermaid);

    const again = await loadMermaidInstance();
    expect(again).toBe(fakeMermaid);
    expect(document.querySelectorAll('script[data-mermaid-loader]')).toHaveLength(1);
  });

  it('throws when mermaid global is missing after script load', async () => {
    const { loadMermaidInstance } = await import('./getMermaidInstance');
    const promise = loadMermaidInstance();
    const script = document.querySelector<HTMLScriptElement>('script[data-mermaid-loader]');
    script?.onload?.(new Event('load'));
    await expect(promise).rejects.toThrow('Mermaid failed to load');
  });

  it('throws when script fails to load', async () => {
    const { loadMermaidInstance } = await import('./getMermaidInstance');
    const promise = loadMermaidInstance();
    const script = document.querySelector<HTMLScriptElement>('script[data-mermaid-loader]');
    script?.onerror?.(new Event('error'));
    await expect(promise).rejects.toThrow('Mermaid failed to load');
  });
});
