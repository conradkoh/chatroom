import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockInitialize = vi.fn();
const mockRender = vi.fn();

vi.mock('./getMermaidInstance', () => ({
  loadMermaidInstance: vi.fn(),
}));

describe('renderMermaidChartToSvg', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false }))
    );
  });
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns post-processed SVG after loader succeeds', async () => {
    const { loadMermaidInstance } = await import('./getMermaidInstance');
    vi.mocked(loadMermaidInstance).mockResolvedValue({
      initialize: mockInitialize,
      render: mockRender,
    } as never);
    mockRender.mockResolvedValue({
      svg: '<svg style="max-width:100px" viewBox="0 0 100 50" overflow="hidden"><foreignObject></foreignObject></svg>',
    });

    const { renderMermaidChartToSvg } = await import('./renderMermaidChartToSvg');
    const result = await renderMermaidChartToSvg('flowchart TD\n  A --> B');

    expect(loadMermaidInstance).toHaveBeenCalledTimes(1);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
    expect(mockRender).toHaveBeenCalledWith(
      expect.stringMatching(/^mermaid-export-/),
      'flowchart TD\n  A --> B'
    );
    expect(result).toContain('<svg');
    expect(result).toContain('overflow="visible"');
    expect(result).not.toContain('max-width:');
    expect(result).toMatch(/viewBox="-8 -8 116 66"/);
  });

  it('propagates loader failure', async () => {
    const { loadMermaidInstance } = await import('./getMermaidInstance');
    vi.mocked(loadMermaidInstance).mockRejectedValue(new Error('Mermaid failed to load'));
    const { renderMermaidChartToSvg } = await import('./renderMermaidChartToSvg');
    await expect(renderMermaidChartToSvg('flowchart TD\n  A --> B')).rejects.toThrow(
      'Mermaid failed to load'
    );
  });
});
