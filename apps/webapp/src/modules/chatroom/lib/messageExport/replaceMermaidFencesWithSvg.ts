import { renderMermaidChartToSvg } from '../mermaid/renderMermaidChartToSvg';

const MERMAID_FENCE_RE = /```mermaid\n([\s\S]*?)```/g;

export async function replaceMermaidFencesWithSvg(markdown: string): Promise<string> {
  const matches = [...markdown.matchAll(MERMAID_FENCE_RE)];
  if (matches.length === 0) return markdown;

  const replacements = await Promise.all(
    matches.map(async (match) => {
      try {
        const svg = await renderMermaidChartToSvg(match[1]);
        return `<div class="export-diagram">${svg}</div>`;
      } catch {
        return match[0];
      }
    })
  );

  let i = 0;
  return markdown.replace(MERMAID_FENCE_RE, () => replacements[i++]!);
}
