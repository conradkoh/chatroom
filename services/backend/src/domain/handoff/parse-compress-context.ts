export type CompressContextMode = 'new_session' | 'none';

const SECTION_HEADINGS = ['## Session Management', '## Restart new context'];
const DATA_TAG = /\/\/\s*data:agent\.compress_context=(new_session|reset|none)\b/i;

const DEFAULT_MODE: CompressContextMode = 'new_session';

function findSectionIndex(content: string, headings: string[]): number {
  const indices = headings.map((heading) => content.indexOf(heading)).filter((idx) => idx !== -1);
  return indices.length === 0 ? -1 : Math.min(...indices);
}

function normalizeMode(raw: string): CompressContextMode {
  const value = raw.toLowerCase();
  if (value === 'reset') return 'new_session';
  if (value === 'none') return value;
  return DEFAULT_MODE;
}

function extractSectionBody(content: string, sectionIdx: number): string {
  const matchedHeading =
    SECTION_HEADINGS.find((h) => content.indexOf(h, sectionIdx) === sectionIdx) ??
    SECTION_HEADINGS[0];
  const afterSection = content.slice(sectionIdx);
  const nextHeading = afterSection.slice(matchedHeading.length).search(/\n## /);
  return nextHeading === -1
    ? afterSection
    : afterSection.slice(0, matchedHeading.length + nextHeading);
}

/** Parse compress_context from planner handoff body. Defaults to 'new_session' if missing/invalid. */
export function parseCompressContext(handoffContent: string): CompressContextMode {
  const sectionIdx = findSectionIndex(handoffContent, SECTION_HEADINGS);
  if (sectionIdx === -1) return DEFAULT_MODE;

  const match = extractSectionBody(handoffContent, sectionIdx).match(DATA_TAG);
  if (!match) return DEFAULT_MODE;
  return normalizeMode(match[1]);
}

/** Map mode to daemon wantResume for ensureRunning after stop nudge. */
export function compressContextToWantResume(mode: CompressContextMode): boolean {
  return mode === 'none';
}
