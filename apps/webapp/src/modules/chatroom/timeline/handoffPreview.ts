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
const FENCE_LINE_PATTERN = /^(?:`{3,}|~{3,})/;

function stripMarkdownSyntax(line: string): string {
  return line
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
  if (text.length <= PREVIEW_MAX_CHARS) return text;
  return `${text.slice(0, PREVIEW_MAX_CHARS - 1).trimEnd()}…`;
}

/**
 * Drops fenced code block lines, tracking the fence state in one pass. Returns
 * the surviving lines plus whether any fence was seen, so an all-code handoff can
 * still show a placeholder instead of a blank preview.
 */
function stripFencedLines(content: string): { lines: string[]; skippedFence: boolean } {
  const lines: string[] = [];
  let inFence = false;
  let skippedFence = false;

  for (const line of unwrapMarkdownPresentationFence(content).split(/\r?\n/)) {
    const isFenceLine = FENCE_LINE_PATTERN.test(line.trim());
    if (isFenceLine) {
      inFence = !inFence;
      skippedFence = true;
    } else if (!inFence) {
      lines.push(line);
    }
  }

  return { lines, skippedFence };
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
