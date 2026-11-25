/**
 * Validate Grounding
 *
 * Pure validator for the `type: 'grounding'` markdown (see
 * `grounding-template-spec.ts`). Every consumer calls this function rather than
 * re-implementing the template rules.
 *
 * Contract:
 * - Never throws. Malformed input always returns `{ ok: false, errors }`.
 * - Reports *all* errors in a single pass, each with a 1-based line number. The
 *   only early exit is the length check, which returns just `GROUNDING_TOO_LONG`.
 * - Checks the section skeleton only: no claim about the neutrality of the
 *   content is made here.
 * - Headings and title-like lines inside fenced code blocks (``` or ~~~) are
 *   content. A fence is closed by a bare run of the same character at least as
 *   long as its opener; an unclosed fence is `GROUNDING_FENCE_UNCLOSED` at its
 *   opening line.
 * - A section body may be exactly `None observed.` (or `- None observed.`) only
 *   in the sections listed in `GROUNDING_NONE_ALLOWED_SECTIONS`.
 */

import {
  GROUNDING_HEADINGS,
  GROUNDING_MAX_CHARS,
  GROUNDING_NONE_ALLOWED_SECTIONS,
  GROUNDING_NONE_TOKEN,
  GROUNDING_SECTION_NAMES,
  GROUNDING_SECTION_ORDER,
  type GroundingErrorCode,
  type GroundingSectionName,
} from './grounding-template-spec';

export interface GroundingError {
  code: GroundingErrorCode;
  /** 1-indexed line in the submitted content. */
  line: number;
  message: string;
}
export type GroundingValidation = { ok: true } | { ok: false; errors: GroundingError[] };

const TITLE_PATTERN = /^#\s+\S/;
const SECTION_HEADING_PATTERN = /^##\s+(\S.*?)\s*$/;
const FENCE_OPENER_PATTERN = /^(`{3,}|~{3,})/;
const SECTION_NAME_TO_KEY: Record<string, GroundingSectionName> = Object.fromEntries(
  GROUNDING_SECTION_ORDER.map((key) => [GROUNDING_SECTION_NAMES[key], key])
);

interface OpenFence {
  char: string;
  length: number;
  line: number;
}

interface HeadingLine {
  /** 0-based line index. */
  index: number;
  text: string;
  /** Null when the heading text is not one of the template section names. */
  key: GroundingSectionName | null;
}

function unclosedFenceError(fence: OpenFence): GroundingError {
  return {
    code: 'GROUNDING_FENCE_UNCLOSED',
    line: fence.line,
    message: `Code fence opened on line ${fence.line} is never closed`,
  };
}

function isFenceCloser(trimmed: string, fence: OpenFence): boolean {
  return new RegExp(`^${fence.char}{${fence.length},}$`).test(trimmed);
}

/** The opener run of a fenced block, or null when the line does not open one. */
function fenceOpener(trimmed: string, index: number): OpenFence | null {
  const run = FENCE_OPENER_PATTERN.exec(trimmed)?.[1];
  if (run === undefined) return null;
  return { char: run.charAt(0), length: run.length, line: index + 1 };
}

/**
 * Mark every line that belongs to a fenced block. Reports an unclosed fence at
 * its opening line. Private: fence tracking is deliberately local to this file.
 */
function trackFences(lines: string[], errors: GroundingError[]): boolean[] {
  const fenced = lines.map(() => false);
  let fence: OpenFence | null = null;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (fence === null) {
      fence = fenceOpener(trimmed, index);
      fenced[index] = fence !== null;
      return;
    }
    const open = fence;
    fenced[index] = true;
    if (isFenceCloser(trimmed, open)) fence = null;
  });
  if (fence !== null) errors.push(unclosedFenceError(fence));
  return fenced;
}

/** First unfenced, non-blank line index, or -1. */
function firstContentLine(lines: string[], fenced: boolean[]): number {
  return lines.findIndex((line, index) => fenced[index] !== true && line.trim() !== '');
}

/** Index of the next unfenced `## ` heading at or after `start`, or -1. */
function nextHeadingIndex(lines: string[], fenced: boolean[], start: number): number {
  return lines.findIndex((line, index) => index >= start && isHeadingLine(line, fenced[index]));
}

function isHeadingLine(line: string, fenced: boolean | undefined): boolean {
  return fenced !== true && SECTION_HEADING_PATTERN.test(line);
}

/** Every unfenced `## ` heading, in document order. */
function collectHeadings(lines: string[], fenced: boolean[]): HeadingLine[] {
  const headings: HeadingLine[] = [];
  for (let index = 0; index < lines.length; index++) {
    const heading = headingAt(lines[index] ?? '', index, fenced[index]);
    if (heading !== null) headings.push(heading);
  }
  return headings;
}

function headingAt(line: string, index: number, fenced: boolean | undefined): HeadingLine | null {
  if (fenced === true) return null;
  const text = headingText(line);
  if (text === null) return null;
  return { index, text, key: SECTION_NAME_TO_KEY[text] ?? null };
}

function headingText(line: string): string | null {
  return SECTION_HEADING_PATTERN.exec(line)?.[1] ?? null;
}

function titleError(line: number): GroundingError {
  return {
    code: 'GROUNDING_TITLE_MISSING',
    line,
    message: `Grounding must start with a "${GROUNDING_HEADINGS.title}" title`,
  };
}

function checkTitle(lines: string[], fenced: boolean[], errors: GroundingError[]): void {
  const index = firstContentLine(lines, fenced);
  if (index === -1) {
    errors.push(titleError(1));
    return;
  }
  const line = lines[index];
  if (line !== undefined && TITLE_PATTERN.test(line)) return;
  errors.push(titleError(index + 1));
}

function reportUnknownHeadings(headings: HeadingLine[], errors: GroundingError[]): void {
  for (const heading of headings) {
    if (heading.key !== null) continue;
    errors.push({
      code: 'GROUNDING_SECTION_ORDER',
      line: heading.index + 1,
      message: `Unknown section "${heading.text}"`,
    });
  }
}

/** First occurrence line of each known section, in document order; duplicates error. */
function firstOccurrences(
  headings: HeadingLine[],
  errors: GroundingError[]
): Map<GroundingSectionName, number> {
  const firstSeenAt = new Map<GroundingSectionName, number>();
  for (const heading of headings) {
    const key = heading.key;
    if (key === null) continue;
    if (firstSeenAt.has(key)) {
      errors.push({
        code: 'GROUNDING_SECTION_ORDER',
        line: heading.index + 1,
        message: `Duplicate section "${GROUNDING_SECTION_NAMES[key]}"`,
      });
      continue;
    }
    firstSeenAt.set(key, heading.index);
  }
  return firstSeenAt;
}

function reportOutOfOrder(
  firstSeenAt: Map<GroundingSectionName, number>,
  errors: GroundingError[]
): void {
  let previousRank = -1;
  for (const [key, index] of firstSeenAt) {
    const rank = GROUNDING_SECTION_ORDER.indexOf(key);
    if (rank < previousRank) {
      errors.push({
        code: 'GROUNDING_SECTION_ORDER',
        line: index + 1,
        message: `Section "${GROUNDING_SECTION_NAMES[key]}" is out of order`,
      });
    }
    previousRank = rank;
  }
}

function reportMissingSections(
  firstSeenAt: Map<GroundingSectionName, number>,
  errors: GroundingError[]
): void {
  for (const key of GROUNDING_SECTION_ORDER) {
    if (firstSeenAt.has(key)) continue;
    errors.push({
      code: 'GROUNDING_SECTION_MISSING',
      line: 1,
      message: `Missing section "${GROUNDING_SECTION_NAMES[key]}"`,
    });
  }
}

function isNoneOnlyBody(lines: string[]): boolean {
  const nonBlank = lines.map((line) => line.trim()).filter((line) => line !== '');
  return nonBlank.every(
    (line) => line === GROUNDING_NONE_TOKEN || line === `- ${GROUNDING_NONE_TOKEN}`
  );
}

function sectionIsEmpty(body: string[], allowsNone: boolean): boolean {
  if (!body.some((line) => line.trim() !== '')) return true;
  return !allowsNone && isNoneOnlyBody(body);
}

function reportSectionBodies(
  lines: string[],
  fenced: boolean[],
  firstSeenAt: Map<GroundingSectionName, number>,
  errors: GroundingError[]
): void {
  for (const [key, headingIndex] of firstSeenAt) {
    const nextHeading = nextHeadingIndex(lines, fenced, headingIndex + 1);
    const body = lines.slice(headingIndex + 1, nextHeading === -1 ? undefined : nextHeading);
    if (!sectionIsEmpty(body, GROUNDING_NONE_ALLOWED_SECTIONS.includes(key))) continue;
    errors.push({
      code: 'GROUNDING_SECTION_EMPTY',
      line: headingIndex + 1,
      message: `Section "${GROUNDING_SECTION_NAMES[key]}" must have content`,
    });
  }
}

export function validateGrounding(content: string): GroundingValidation {
  if (content.length > GROUNDING_MAX_CHARS) {
    return {
      ok: false,
      errors: [
        { code: 'GROUNDING_TOO_LONG', line: 1, message: 'Grounding exceeds 20000 characters' },
      ],
    };
  }

  const lines = content.split('\n');
  const errors: GroundingError[] = [];
  const fenced = trackFences(lines, errors);
  checkTitle(lines, fenced, errors);

  const headings = collectHeadings(lines, fenced);
  reportUnknownHeadings(headings, errors);
  const firstSeenAt = firstOccurrences(headings, errors);
  reportOutOfOrder(firstSeenAt, errors);

  reportMissingSections(firstSeenAt, errors);
  reportSectionBodies(lines, fenced, firstSeenAt, errors);

  if (errors.length === 0) return { ok: true };
  return { ok: false, errors };
}
