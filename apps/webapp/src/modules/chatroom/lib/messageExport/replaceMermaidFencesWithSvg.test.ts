import { describe, expect, it, vi } from 'vitest';

import { replaceMermaidFencesWithSvg } from './replaceMermaidFencesWithSvg';

const mockRenderMermaidChartToSvg = vi.fn(async (chart: string) => `<svg>${chart}</svg>`);

vi.mock('../mermaid/renderMermaidChartToSvg', () => ({
  renderMermaidChartToSvg: (...args: Parameters<typeof mockRenderMermaidChartToSvg>) =>
    mockRenderMermaidChartToSvg(...args),
}));

describe('replaceMermaidFencesWithSvg', () => {
  it('replaces a single mermaid fence with SVG div', async () => {
    const input = 'Hello\n```mermaid\ngraph TD\n  A-->B\n```\nWorld';
    const result = await replaceMermaidFencesWithSvg(input);
    expect(result).toContain('<div class="export-diagram">');
    expect(result).toContain('<svg>');
    expect(result).toContain('graph TD');
    expect(result).not.toContain('```mermaid');
  });

  it('handles multiple mermaid fences', async () => {
    const input =
      '```mermaid\ngraph LR\n  A-->B\n```\ntext\n```mermaid\nsequenceDiagram\n  A->>B\n```';
    const result = await replaceMermaidFencesWithSvg(input);
    const matches = result.match(/<div class="export-diagram">/g);
    expect(matches).toHaveLength(2);
  });

  it('returns markdown unchanged when no mermaid fences', async () => {
    const input = 'Just some **markdown** without diagrams.';
    const result = await replaceMermaidFencesWithSvg(input);
    expect(result).toBe(input);
  });

  it('keeps original fence on render error', async () => {
    mockRenderMermaidChartToSvg.mockRejectedValueOnce(new Error('render failed'));
    const input = '```mermaid\nbad diagram\n```';
    const result = await replaceMermaidFencesWithSvg(input);
    expect(result).toContain('```mermaid');
  });
});
