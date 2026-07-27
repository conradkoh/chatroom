export interface HandoffReportParseResult {
  hasReport: boolean;
  summary: string;
  proofs: string | null;
  details: string | null;
  warnings: string[];
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

export function parseHandoffReport(content: string): HandoffReportParseResult {
  const warnings: string[] = [];

  const proofsResult = extractTag(content, 'handoff-proofs');
  const detailsResult = extractTag(content, 'handoff-details');

  if (proofsResult.hadOpen && !proofsResult.hadClose) {
    warnings.push('Unclosed <handoff-proofs> tag');
  }
  if (detailsResult.hadOpen && !detailsResult.hadClose) {
    warnings.push('Unclosed <handoff-details> tag');
  }
  if (proofsResult.hadClose && !proofsResult.hadOpen) {
    warnings.push('Closing </handoff-proofs> without opening tag');
  }
  if (detailsResult.hadClose && !detailsResult.hadOpen) {
    warnings.push('Closing </handoff-details> without opening tag');
  }

  if (!proofsResult.hadOpen && !detailsResult.hadOpen) {
    return { hasReport: false, summary: '', proofs: null, details: null, warnings };
  }

  const summary = content.split(/<handoff-proofs\s*>/i)[0]?.trim() ?? '';

  return {
    hasReport: true,
    summary,
    proofs: proofsResult.body,
    details: detailsResult.body,
    warnings,
  };
}

export function hasHandoffReport(content: string): boolean {
  return parseHandoffReport(content).hasReport;
}
