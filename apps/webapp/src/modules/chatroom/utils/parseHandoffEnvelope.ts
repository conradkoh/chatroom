import { extractHandoffXmlTag } from './extractHandoffXmlTag';

export type HandoffEnvelopeSectionId = 'user-message' | 'grounding' | 'builder-handoff';

export interface HandoffEnvelopeSection {
  id: HandoffEnvelopeSectionId;
  label: string;
  body: string;
}

export interface HandoffEnvelopeParseResult {
  hasEnvelope: boolean;
  sections: HandoffEnvelopeSection[];
  preamble: string;
  warnings: string[];
}

const SECTION_DEFS: { id: HandoffEnvelopeSectionId; label: string }[] = [
  { id: 'user-message', label: 'User message' },
  { id: 'grounding', label: 'Grounding' },
  { id: 'builder-handoff', label: 'Builder handoff draft' },
];

export function parseHandoffEnvelope(content: string): HandoffEnvelopeParseResult {
  const warnings: string[] = [];
  const sections: HandoffEnvelopeSection[] = [];

  for (const def of SECTION_DEFS) {
    const { body, hadOpen, hadClose } = extractHandoffXmlTag(content, def.id);
    if (hadOpen && !hadClose) {
      warnings.push(`Unclosed <${def.id}> tag`);
    }
    if (hadClose && !hadOpen) {
      warnings.push(`Closing </${def.id}> without opening tag`);
    }
    if (body) {
      sections.push({ id: def.id, label: def.label, body });
    }
  }

  const firstOpen = SECTION_DEFS.map((d) =>
    content.search(new RegExp(`<${d.id}\\s*>`, 'i'))
  ).filter((i) => i >= 0);
  const preamble =
    firstOpen.length > 0 ? content.slice(0, Math.min(...firstOpen)).trim() : content.trim();

  if (sections.length === 0) {
    return { hasEnvelope: false, sections: [], preamble: '', warnings };
  }

  const stripped = SECTION_DEFS.reduce(
    (acc, d) => acc.replace(new RegExp(`<${d.id}\\s*>[\s\S]*?</${d.id}\\s*>`, 'gi'), ''),
    content
  ).trim();
  if (stripped.length > 40) {
    warnings.push('Content outside known envelope sections');
  }

  return { hasEnvelope: true, sections, preamble, warnings };
}

export function hasHandoffEnvelope(content: string): boolean {
  return parseHandoffEnvelope(content).hasEnvelope;
}
