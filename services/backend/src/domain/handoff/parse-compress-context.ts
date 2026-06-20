export type CompressContextMode = 'reset' | 'compact' | 'none';

const SECTION_HEADING = '## Restart new context';
const DATA_TAG = /\/\/\s*data:agent\.compress_context=(reset|compact|none)\b/i;

/** Parse compress_context from planner handoff body. Defaults to 'none' if missing/invalid. */
export function parseCompressContext(handoffContent: string): CompressContextMode {
  const sectionIdx = handoffContent.indexOf(SECTION_HEADING);
  if (sectionIdx === -1) return 'none';

  // Search only within this section until next ## heading or EOF
  const afterSection = handoffContent.slice(sectionIdx);
  const nextHeading = afterSection.slice(SECTION_HEADING.length).search(/\n## /);
  const sectionBody =
    nextHeading === -1 ? afterSection : afterSection.slice(0, SECTION_HEADING.length + nextHeading);

  const match = sectionBody.match(DATA_TAG);
  if (!match) return 'none';
  return match[1].toLowerCase() as CompressContextMode;
}

/** Map mode to daemon wantResume for ensureRunning after stop nudge. */
export function compressContextToWantResume(mode: CompressContextMode): boolean {
  return mode === 'none';
}
