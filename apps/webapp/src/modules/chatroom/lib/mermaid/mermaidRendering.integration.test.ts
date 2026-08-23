import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockInitialize = vi.fn();
const mockRender = vi.fn();
const fakeMermaid = { initialize: mockInitialize, render: mockRender };

describe('mermaid rendering integration', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false }))
    );
    vi.stubGlobal('mermaid', undefined);
    mockInitialize.mockReset();
    mockRender.mockReset();
    mockRender.mockResolvedValue({ svg: '<svg viewBox="0 0 200 100"><text>ok</text></svg>' });
  });

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    document.querySelectorAll('script[data-mermaid-loader]').forEach((el) => el.remove());
  });

  it('renders SVG after classic script load sets globalThis.mermaid', async () => {
    const { loadMermaidInstance } = await import('./getMermaidInstance');
    const loadPromise = loadMermaidInstance();
    const script = document.querySelector<HTMLScriptElement>('script[data-mermaid-loader]');
    expect(script?.src).toContain('/vendor/mermaid.min.js');
    vi.stubGlobal('mermaid', fakeMermaid);
    script?.onload?.(new Event('load'));
    await loadPromise;

    const { renderMermaidChartToSvg } = await import('./renderMermaidChartToSvg');
    const chart = 'flowchart TD\n  U[User request] --> P[Planner]';
    const svg = await renderMermaidChartToSvg(chart);
    expect(svg).toContain('<svg');
    expect(mockRender).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-export-/), chart);
  });
});
