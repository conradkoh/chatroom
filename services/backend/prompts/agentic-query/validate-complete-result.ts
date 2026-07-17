export interface AgenticQueryCompleteValidation {
  ok: true;
  summary: string;
  results: string;
  grounding: string;
  files: string;
}

export interface AgenticQueryCompleteValidationError {
  ok: false;
  message: string;
}

export type AgenticQueryCompleteValidationResult =
  | AgenticQueryCompleteValidation
  | AgenticQueryCompleteValidationError;

function extractSection(body: string, heading: string): string | null {
  const pattern = new RegExp(`^##\\s+${heading}\\s*$`, 'im');
  const match = pattern.exec(body);
  if (!match) return null;

  const start = match.index + match[0].length;
  const rest = body.slice(start);
  const nextHeading = rest.search(/^##\s+\S/m);
  const section = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
  return section;
}

// fallow-ignore-next-line complexity
export function validateAgenticQueryCompleteResult(
  body: string
): AgenticQueryCompleteValidationResult {
  const trimmed = body.trim();
  if (!trimmed) {
    return { ok: false, message: 'Result body is empty' };
  }

  const summary = extractSection(trimmed, 'Summary');
  const results = extractSection(trimmed, 'Results');
  const grounding = extractSection(trimmed, 'Grounding');
  const files = extractSection(trimmed, 'Files');

  if (!summary) {
    return { ok: false, message: 'Missing required ## Summary section' };
  }
  if (!results) {
    return { ok: false, message: 'Missing required ## Results section' };
  }
  if (!files) {
    return { ok: false, message: 'Missing required ## Files section' };
  }

  return {
    ok: true,
    summary,
    results,
    grounding: grounding ?? '',
    files,
  };
}
