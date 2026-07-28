function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '').trim();
}

function isNotApplicableLine(line: string): boolean {
  const trimmed = line.replace(/^[-*]\s*/, '').trim();
  return /^not applicable\b/i.test(trimmed);
}

export function isNotApplicableContent(text: string): boolean {
  const stripped = stripComments(text);
  if (!stripped) return true;
  const lines = stripped
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return true;
  return lines.every(isNotApplicableLine);
}

export function parseMarkdownH2Sections(body: string): { heading: string; content: string }[] {
  const parts = body.split(/\n(?=## )/);
  const sections: { heading: string; content: string }[] = [];
  for (const part of parts) {
    const match = /^## (.+)\n?([\s\S]*)$/.exec(part);
    if (match) {
      sections.push({ heading: match[1].trim(), content: match[2] ?? '' });
    }
  }
  return sections;
}

export function extractH2Section(
  body: string,
  heading: string
): { extracted: string | null; remainder: string } {
  const sections = parseMarkdownH2Sections(body);
  const normalized = heading.toLowerCase();
  const target = sections.find((s) => s.heading.toLowerCase() === normalized);
  if (!target) return { extracted: null, remainder: body };
  const remainderSections = sections.filter((s) => s.heading.toLowerCase() !== normalized);
  const remainder = remainderSections
    .map((s) => `## ${s.heading}\n${s.content}`)
    .join('\n\n')
    .trim();
  return { extracted: target.content.trim(), remainder };
}

export function isHandoffSectionEmpty(body: string): boolean {
  const sections = parseMarkdownH2Sections(body);
  if (sections.length === 0) return isNotApplicableContent(body);
  return sections.every((s) => isNotApplicableContent(s.content));
}

export function isHandoffSectionBodyEmpty(body: string | null): boolean {
  if (body === null || body === '') return true;
  return isHandoffSectionEmpty(body);
}

export function countNonemptySubsections(body: string): number {
  const sections = parseMarkdownH2Sections(body);
  if (sections.length === 0) {
    return isNotApplicableContent(body) ? 0 : 1;
  }
  return sections.filter((s) => !isNotApplicableContent(s.content)).length;
}
