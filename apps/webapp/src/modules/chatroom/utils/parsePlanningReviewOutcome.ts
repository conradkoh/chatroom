/**
 * Parser for `<planning-review-outcome>` enhancer messages (cancelled/failed reviews).
 *
 * Detection is deliberately loose (mirrors the backend `isPlanningReviewOutcomeContent`):
 * it only requires the opening tag name, so unknown/missing `status` attributes still
 * render the structured view instead of raw XML.
 */

export type PlanningReviewOutcomeStatus = 'cancelled' | 'failed';

export interface PlanningReviewOutcomeParseResult {
  hasOutcome: boolean;
  status: PlanningReviewOutcomeStatus | null;
  body: string | null;
  warnings: string[];
}

export function hasPlanningReviewOutcome(content: string): boolean {
  return /<planning-review-outcome\s/i.test(content);
}
export function parsePlanningReviewOutcome(content: string): PlanningReviewOutcomeParseResult {
  const openMatch = /<planning-review-outcome(?:\s+status="([^"]*)")?\s*>/i.exec(content);
  const closeMatch = /<\/planning-review-outcome\s*>/i.exec(content);

  return {
    hasOutcome: hasPlanningReviewOutcome(content),
    status: parseStatus(openMatch?.[1]),
    body: extractOutcomeBody(content, openMatch, closeMatch),
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
