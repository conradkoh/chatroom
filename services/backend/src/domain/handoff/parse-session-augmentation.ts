import { roleSupportsSessionAugmentation } from '../entities/team-agent-settings';

export type SessionAugmentationMode = 'none' | 'compact' | 'new_session';

const SECTION_HEADINGS = [
  '## Session Augmentation',
  '## Session Management',
  '## Restart new context',
];
const DATA_TAG =
  /\/\/\s*data:agent\.(?:session_augmentation|compress_context)=(none|compact|new_session|reset)\b/i;

const DEFAULT_MODE: SessionAugmentationMode = 'new_session';

function findSectionIndex(content: string, headings: string[]): number {
  const indices = headings.map((heading) => content.indexOf(heading)).filter((idx) => idx !== -1);
  return indices.length === 0 ? -1 : Math.min(...indices);
}

const MODE_ALIASES: Record<string, SessionAugmentationMode> = {
  reset: 'new_session',
  none: 'none',
  compact: 'compact',
  new_session: 'new_session',
};

function normalizeMode(raw: string): SessionAugmentationMode {
  return MODE_ALIASES[raw.toLowerCase()] ?? DEFAULT_MODE;
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

/** Parse session_augmentation from planner handoff body. Defaults to 'new_session' if missing/invalid. */
export function parseSessionAugmentation(handoffContent: string): SessionAugmentationMode {
  const sectionIdx = findSectionIndex(handoffContent, SECTION_HEADINGS);
  if (sectionIdx === -1) return DEFAULT_MODE;

  const match = extractSectionBody(handoffContent, sectionIdx).match(DATA_TAG);
  if (!match) return DEFAULT_MODE;
  return normalizeMode(match[1]);
}

/** Parse session augmentation for task delivery. Non-augmentable roles always get `none`. */
export function resolveSessionAugmentationForRole(
  handoffContent: string,
  role: string
): SessionAugmentationMode {
  if (!roleSupportsSessionAugmentation(role)) {
    return 'none';
  }
  return parseSessionAugmentation(handoffContent);
}

/** Map mode to daemon wantResume for ensureRunning after stop nudge. */
export function sessionAugmentationToWantResume(mode: SessionAugmentationMode): boolean {
  return mode === 'none' || mode === 'compact';
}

/** Whether the augmentation mode starts a completely new agent session. */
export function sessionAugmentationNewSessionStarted(mode: SessionAugmentationMode): boolean {
  return mode === 'new_session';
}
