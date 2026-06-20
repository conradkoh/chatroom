export type CompressContextMode = 'new_session' | 'none';

const SECTION_HEADINGS = ['## Session Management', '## Restart new context'];
const DATA_TAG = /\/\/\s*data:agent\.compress_context=(new_session|reset|none)\b/i;

const DEFAULT_MODE: CompressContextMode = 'new_session';

function findSectionHeading(content: string): string | null {
  const found = SECTION_HEADINGS.map((heading) => ({
    heading,
    idx: content.indexOf(heading),
  }))
    .filter((entry) => entry.idx !== -1)
    .sort((a, b) => a.idx - b.idx);
  return found[0]?.heading ?? null;
}

function normalizeMode(raw: string): CompressContextMode {
  const value = raw.toLowerCase();
  if (value === 'reset') return 'new_session';
  if (value === 'none') return value;
  return DEFAULT_MODE;
}

/** Parse compress_context from planner handoff body. Defaults to 'new_session' if missing/invalid. */
export function parseCompressContext(handoffContent: string): CompressContextMode {
  const heading = findSectionHeading(handoffContent);
  if (!heading) return DEFAULT_MODE;

  const sectionIdx = handoffContent.indexOf(heading);
  const afterSection = handoffContent.slice(sectionIdx);
  const nextHeading = afterSection.slice(heading.length).search(/\n## /);
  const sectionBody =
    nextHeading === -1 ? afterSection : afterSection.slice(0, heading.length + nextHeading);

  const match = sectionBody.match(DATA_TAG);
  if (!match) return DEFAULT_MODE;
  return normalizeMode(match[1]);
}

/** Map mode to daemon wantResume for ensureRunning after stop nudge. */
export function compressContextToWantResume(mode: CompressContextMode): boolean {
  return mode === 'none';
}
