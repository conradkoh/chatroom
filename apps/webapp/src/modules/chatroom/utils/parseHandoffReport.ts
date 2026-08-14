import { HANDOFF_REPORT_XML_TAGS } from './handoffXmlTags';

export type HandoffReportFormat = 'structured' | 'legacy';

export interface HandoffReportParseResult {
  format: HandoffReportFormat;
  hasReport: boolean;
  warnings: string[];
  // Structured (new)
  overview: string | null;
  proofs: string | null;
  direction: string | null;
  ux: string | null;
  defragmentation: string | null;
  notes: string | null;
  action: string | null;
  // Legacy fallback
  summary: string;
  details: string | null;
}

function extractTag(
  content: string,
  tag: string
): { body: string | null; hadOpen: boolean; hadClose: boolean } {
  const openRe = new RegExp(`<${tag}\\s*>`, 'i');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
  const hadOpen = openRe.test(content);
  const hadClose = closeRe.test(content);
  const match = new RegExp(`<${tag}\\s*>([\\s\\S]*?)</${tag}\\s*>`, 'i').exec(content);
  return { body: match ? match[1].trim() : null, hadOpen, hadClose };
}

const STRUCTURED_TAGS = [
  'handoff-overview',
  'handoff-direction',
  'handoff-notes',
  'handoff-action',
] as const;
const ALL_TAGS = HANDOFF_REPORT_XML_TAGS;

function hasAnyTag(content: string, tags: readonly string[]): boolean {
  return tags.some((tag) => new RegExp(`<${tag}\\s*>`, 'i').test(content));
}

export function parseHandoffReport(content: string): HandoffReportParseResult {
  const warnings: string[] = [];

  const overviewResult = extractTag(content, 'handoff-overview');
  const proofsResult = extractTag(content, 'handoff-proofs');
  const directionResult = extractTag(content, 'handoff-direction');
  const uxResult = extractTag(content, 'handoff-ux');
  const defragmentationResult = extractTag(content, 'handoff-defragmentation');
  const notesResult = extractTag(content, 'handoff-notes');
  const actionResult = extractTag(content, 'handoff-action');
  const detailsResult = extractTag(content, 'handoff-details');

  for (const tag of ALL_TAGS) {
    const result = extractTag(content, tag);
    if (result.hadOpen && !result.hadClose) {
      warnings.push(`Unclosed <${tag}> tag`);
    }
    if (result.hadClose && !result.hadOpen) {
      warnings.push(`Closing </${tag}> without opening tag`);
    }
  }

  // Structured format: any structured tag present
  if (hasAnyTag(content, STRUCTURED_TAGS)) {
    return {
      format: 'structured',
      hasReport: true,
      overview: overviewResult.body,
      proofs: proofsResult.body,
      direction: directionResult.body,
      ux: uxResult.body,
      defragmentation: defragmentationResult.body,
      notes: notesResult.body,
      action: actionResult.body,
      summary: overviewResult.body ?? '',
      details: detailsResult.body,
      warnings,
    };
  }

  // Legacy format: handoff-proofs or handoff-details present
  if (proofsResult.hadOpen || detailsResult.hadOpen) {
    const summary = content.split(/<handoff-proofs\s*>/i)[0]?.trim() ?? '';
    return {
      format: 'legacy',
      hasReport: true,
      overview: null,
      proofs: proofsResult.body,
      direction: null,
      ux: null,
      defragmentation: null,
      notes: null,
      action: null,
      summary,
      details: detailsResult.body,
      warnings,
    };
  }

  return {
    format: 'legacy',
    hasReport: false,
    overview: null,
    proofs: null,
    direction: null,
    ux: null,
    defragmentation: null,
    notes: null,
    action: null,
    summary: '',
    details: null,
    warnings,
  };
}

export function hasHandoffReport(content: string): boolean {
  return parseHandoffReport(content).hasReport;
}
