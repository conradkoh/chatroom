import { renderMermaidChartToSvg } from '../mermaid/renderMermaidChartToSvg';

const MERMAID_FENCE_RE = /```mermaid\n([\s\S]*?)```/g;

export const MERMAID_EXPORT_PLACEHOLDER_PREFIX = 'MERMAID_EXPORT_PLACEHOLDER_';

export type MermaidFenceReplacement = {
  markdown: string;
  diagrams: Map<number, string>;
};

export async function replaceMermaidFencesWithSvg(
  markdown: string
): Promise<MermaidFenceReplacement> {
  const matches = [...markdown.matchAll(MERMAID_FENCE_RE)];
  if (matches.length === 0) return { markdown, diagrams: new Map() };

  const diagrams = new Map<number, string>();
  let index = 0;

  const replacements = await Promise.all(
    matches.map(async (match) => {
      const currentIndex = index++;
      try {
        const svg = await renderMermaidChartToSvg(match[1]);
        diagrams.set(currentIndex, svg);
        return `\n\n${MERMAID_EXPORT_PLACEHOLDER_PREFIX}${currentIndex}\n\n`;
      } catch {
        return match[0];
      }
    })
  );

  let i = 0;
  const processedMarkdown = markdown.replace(MERMAID_FENCE_RE, () => replacements[i++]!);
  return { markdown: processedMarkdown, diagrams };
}
