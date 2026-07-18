import { renderMermaidChartToSvg } from '../mermaid/renderMermaidChartToSvg';

const MERMAID_FENCE_RE = /```mermaid\n([\s\S]*?)```/g;

export async function replaceMermaidFencesWithSvg(markdown: string): Promise<string> {
  const blocks: { match: string; svg: string }[] = [];

  for (const match of markdown.matchAll(MERMAID_FENCE_RE)) {
    const chart = match[1];
    try {
      const svg = await renderMermaidChartToSvg(chart);
      blocks.push({ match: match[0], svg: `<div class="export-diagram">${svg}</div>` });
    } catch {
      blocks.push({ match: match[0], svg: match[0] });
    }
  }

  let result = markdown;
  for (const block of blocks) {
    result = result.replace(block.match, block.svg);
  }

  return result;
}
