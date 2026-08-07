/**
 * Parser for `<planning-review-outcome>` enhancer messages (cancelled/failed reviews).
 *
 * Detection requires a ROOT-LEVEL opening tag (after an optional `---MESSAGE---`
 * prefix) so enhancer feedback that merely quotes a prior cancelled review in
 * prose/code does not false-positive into the outcome view. Status parsing stays
 * loose — unknown/missing `status` attributes still render the structured view.
 */

export type PlanningReviewOutcomeStatus = 'cancelled' | 'failed';

export interface PlanningReviewOutcomeParseResult {
  hasOutcome: boolean;
  status: PlanningReviewOutcomeStatus | null;
  body: string | null;
  warnings: string[];
}

/** Strip optional handoff CLI marker before root-tag detection. */
function stripMessageMarker(content: string): string {
  return content.replace(/^---MESSAGE---\s*/m, '').trimStart();
}

const ROOT_OUTCOME_OPEN_RE = /^<planning-review-outcome(?:\s+status="([^"]*)")?\s*>/i;
const ROOT_OUTCOME_CLOSE_RE = /<\/planning-review-outcome\s*>/i;

export function hasPlanningReviewOutcome(content: string): boolean {
  return ROOT_OUTCOME_OPEN_RE.test(stripMessageMarker(content));
}

export function parsePlanningReviewOutcome(content: string): PlanningReviewOutcomeParseResult {
  const stripped = stripMessageMarker(content);
  const openMatch = ROOT_OUTCOME_OPEN_RE.exec(stripped);
  const closeMatch = ROOT_OUTCOME_CLOSE_RE.exec(stripped);

  return {
    hasOutcome: openMatch !== null,
    status: parseStatus(openMatch?.[1]),
    body: extractOutcomeBody(stripped, openMatch, closeMatch),
    warnings: outcomeWarnings(openMatch, closeMatch),
  };
}

function parseStatus(rawStatus: string | undefined): PlanningReviewOutcomeStatus | null {
  if (rawStatus === 'cancelled') return 'cancelled';
  if (rawStatus === 'failed') return 'failed';
  return null;
}

function extractOutcomeBody(
  content: string,
  openMatch: RegExpExecArray | null,
  closeMatch: RegExpExecArray | null
): string | null {
  if (!openMatch || !closeMatch) return null;
  return content.slice(openMatch.index + openMatch[0].length, closeMatch.index).trim();
}

function outcomeWarnings(
  openMatch: RegExpExecArray | null,
  closeMatch: RegExpExecArray | null
): string[] {
  if (openMatch && !closeMatch) return ['Unclosed <planning-review-outcome> tag'];
  return [];
}
