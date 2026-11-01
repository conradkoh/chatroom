import { HANDOFF_XML_TAGS } from '../utils/handoffXmlTags';
import { unwrapMarkdownPresentationFence } from '../utils/normalizeChatroomMarkdownContent';

/** Number of plain-text source lines shown in a collapsed handoff preview. */
const PREVIEW_LINE_COUNT = 2;

/** Hard cap for the collapsed preview, including the trailing ellipsis. */
const PREVIEW_MAX_CHARS = 240;

/** Shown when the only content was a fenced block, so the preview is not blank. */
const CODE_BLOCK_PLACEHOLDER = '(code block)';

/**
 * Only known handoff/HTML wrapper tags are removed. A generic `<[^>]+>` pattern
 * would also eat generics and autolinks (`Promise<void>`, `<https://…>`), so the
 * alternation is restricted to the tags the chatroom actually emits.
 */
const WRAPPER_TAG_PATTERN = new RegExp(`</?(?:${HANDOFF_XML_TAGS.join('|')})(?:\\s[^<>]*)?>`, 'gi');
const LINK_PATTERN = /\[([^\]]*)\]\([^)]*\)/g;
const HEADING_MARKER_PATTERN = /^#{1,6}\s+/;
const LIST_OR_QUOTE_MARKER_PATTERN = /^(?:[-*+]\s+|\d+\.\s+|>\s*)/;
const CODE_SPAN_PATTERN = /`([^`]+)`/g;
const BOLD_STAR_PATTERN = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
/**
 * Underscore emphasis only counts when it wraps whitespace-separated text.
 * `__init__` and `snake_case` are far more common in handoff prose than
 * `__bold__`, and the preview must not mangle identifiers.
 */
const BOLD_UNDERSCORE_PATTERN = /(?<!\w)__(?=\S)(.+?)(?<=\S)__(?!\w)/g;
const EMPHASIS_PATTERN = /(?<![\w*_])([*_])(?!\1)(?=\S)(.+?)(?<=\S)\1(?![\w*_])/g;
/** A fence line starts with a run of three or more backticks or tildes. */
const FENCE_RUN_PATTERN = /^(`{3,}|~{3,})/;

/** Opening marker of a fenced block: which character opened it and how long the run was. */
type FenceMarker = { char: string; length: number };

function stripMarkdownSyntax(line: string): string {
  return line
    .trim()
    .replace(WRAPPER_TAG_PATTERN, ' ')
    .replace(LINK_PATTERN, '$1')
    .replace(HEADING_MARKER_PATTERN, '')
    .replace(LIST_OR_QUOTE_MARKER_PATTERN, '')
    .replace(LIST_OR_QUOTE_MARKER_PATTERN, '')
    .replace(CODE_SPAN_PATTERN, '$1')
    .replace(BOLD_STAR_PATTERN, '$1')
    .replace(BOLD_UNDERSCORE_PATTERN, (match, inner: string) => (/\s/.test(inner) ? inner : match))
    .replace(EMPHASIS_PATTERN, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string): string {
  // Count code points, not UTF-16 code units, so the cut never splits a
  // surrogate pair (emoji) in half.
  const chars = Array.from(text);
  if (chars.length <= PREVIEW_MAX_CHARS) return text;
  return `${chars
    .slice(0, PREVIEW_MAX_CHARS - 1)
    .join('')
    .trimEnd()}…`;
}

function getFenceMarker(line: string): FenceMarker | null {
  const match = line.trim().match(FENCE_RUN_PATTERN);
  return match ? { char: match[1][0], length: match[1].length } : null;
}

/**
 * A block closes only on a bare run of the same character that is at least as
 * long as the opener. A ```` ``` ```` line inside a `~~~` block is content, and a
 * shorter run is content too.
 */
function isClosingFence(line: string, opener: FenceMarker): boolean {
  const marker = getFenceMarker(line);
  return (
    marker !== null &&
    marker.char === opener.char &&
    marker.length >= opener.length &&
    line.trim().length === marker.length
  );
}

/** Index just past the fenced block that starts at `start` (or end of input). */
function skipFenceBlock(lines: string[], start: number): number {
  const opener = getFenceMarker(lines[start]) as FenceMarker;
  const closeIndex = lines.findIndex(
    (line, index) => index > start && isClosingFence(line, opener)
  );
  return closeIndex === -1 ? lines.length : closeIndex + 1;
}

/**
 * Drops fenced code block lines. A dropped line means a fence was skipped, which
 * lets an all-code handoff show a placeholder instead of a blank preview.
 */
function stripFencedLines(content: string): { lines: string[]; skippedFence: boolean } {
  const source = unwrapMarkdownPresentationFence(content).split(/\r?\n/);
  const lines: string[] = [];
  let index = 0;

  while (index < source.length) {
    if (getFenceMarker(source[index])) {
      index = skipFenceBlock(source, index);
      continue;
    }
    lines.push(source[index]);
    index += 1;
  }

  return { lines, skippedFence: lines.length !== source.length };
}

/**
 * Strips markdown from the leading lines, stopping as soon as the preview is
 * full so the cost is bounded by the visible prefix, not the whole body.
 */
function takePreviewLines(lines: string[]): string[] {
  const visible: string[] = [];
  lines.some((line) => {
    const stripped = stripMarkdownSyntax(line);
    if (stripped) visible.push(stripped);
    return visible.length === PREVIEW_LINE_COUNT;
  });
  return visible;
}

/**
 * Builds the plain-text preview shown while an agent-to-agent handoff is collapsed.
 *
 * Handoff content is frequently wrapped in a ```` ```markdown ```` presentation
 * fence, so the fence is unwrapped first; only then are inner fenced code blocks
 * skipped. The result is never parsed as markdown — collapsed rows must not mount
 * react-markdown, remark-gfm, or Shiki.
 */
export function getHandoffPreviewText(content: string): string {
  const { lines, skippedFence } = stripFencedLines(content);
  const previewLines = takePreviewLines(lines);
  if (previewLines.length > 0) return truncate(previewLines.join(' '));
  return skippedFence ? CODE_BLOCK_PLACEHOLDER : '';
}
