import { describe, expect, it, vi } from 'vitest';

import { replaceMermaidFencesWithSvg } from './replaceMermaidFencesWithSvg';

const mockRenderMermaidChartToSvg = vi.fn(async (chart: string) => `<svg>${chart}</svg>`);

vi.mock('../mermaid/renderMermaidChartToSvg', () => ({
  renderMermaidChartToSvg: (...args: Parameters<typeof mockRenderMermaidChartToSvg>) =>
    mockRenderMermaidChartToSvg(...args),
}));

describe('replaceMermaidFencesWithSvg', () => {
  it('replaces a single mermaid fence with placeholder and stores SVG', async () => {
    const input = 'Hello\n```mermaid\ngraph TD\n  A-->B\n```\nWorld';
    const result = await replaceMermaidFencesWithSvg(input);
    expect(result.markdown).toContain('MERMAID_EXPORT_PLACEHOLDER_0');
    expect(result.markdown).not.toContain('```mermaid');
    expect(result.diagrams.size).toBe(1);
    expect(result.diagrams.get(0)).toContain('<svg>');
  });

  it('handles multiple mermaid fences', async () => {
    const input =
      '```mermaid\ngraph LR\n  A-->B\n```\ntext\n```mermaid\nsequenceDiagram\n  A->>B\n```';
    const result = await replaceMermaidFencesWithSvg(input);
    expect(result.diagrams.size).toBe(2);
    expect(result.markdown.match(/MERMAID_EXPORT_PLACEHOLDER_\d+/g)).toHaveLength(2);
  });

  it('returns markdown unchanged when no mermaid fences', async () => {
    const input = 'Just some **markdown** without diagrams.';
    const result = await replaceMermaidFencesWithSvg(input);
    expect(result.markdown).toBe(input);
    expect(result.diagrams.size).toBe(0);
  });

  it('keeps original fence on render error', async () => {
    mockRenderMermaidChartToSvg.mockRejectedValueOnce(new Error('render failed'));
    const input = '```mermaid\nbad diagram\n```';
    const result = await replaceMermaidFencesWithSvg(input);
    expect(result.markdown).toContain('```mermaid');
    expect(result.diagrams.size).toBe(0);
  });
});
