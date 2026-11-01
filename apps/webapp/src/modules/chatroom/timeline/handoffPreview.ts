import { unwrapMarkdownPresentationFence } from '../utils/normalizeChatroomMarkdownContent';

/** Number of plain-text source lines shown in a collapsed handoff preview. */
// Test-only consumer: the preview UI hard-codes `line-clamp-2`; this constant
// documents and unit-tests the matching truncation contract.
// fallow-ignore-next-line unused-export
export const HANDOFF_PREVIEW_LINE_COUNT = 2;

/** Hard cap for the collapsed preview, including the trailing ellipsis. */
// Test-only consumer: asserted directly so the preview cannot silently grow.
// fallow-ignore-next-line unused-export
export const HANDOFF_PREVIEW_MAX_CHARS = 240;

const FENCED_BLOCK_PATTERN = /^(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?\n(?:`{3,}|~{3,})[ \t]*$/gm;
const LONE_FENCE_PATTERN = /^(?:`{3,}|~{3,})[^\n]*$/gm;
const HTML_TAG_PATTERN = /<[^>]+>/g;
const LINK_PATTERN = /\[([^\]]*)\]\([^)]*\)/g;
const HEADING_MARKER_PATTERN = /^#{1,6}\s+/;
const LIST_OR_QUOTE_MARKER_PATTERN = /^(?:[-*+]\s+|\d+\.\s+|>\s*)/;
const EMPHASIS_PATTERN = /(\*\*|__|`|\*|_)/g;

function stripMarkdownSyntax(line: string): string {
  return line
    .replace(HTML_TAG_PATTERN, ' ')
    .replace(LINK_PATTERN, '$1')
    .replace(HEADING_MARKER_PATTERN, '')
    .replace(LIST_OR_QUOTE_MARKER_PATTERN, '')
    .replace(LIST_OR_QUOTE_MARKER_PATTERN, '')
    .replace(EMPHASIS_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string): string {
  if (text.length <= HANDOFF_PREVIEW_MAX_CHARS) return text;
  return `${text.slice(0, HANDOFF_PREVIEW_MAX_CHARS - 1).trimEnd()}…`;
}

/** Drops fenced code blocks, including the fence marker lines themselves. */
function stripFencedBlocks(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .join('\n')
    .replace(FENCED_BLOCK_PATTERN, '')
    .replace(LONE_FENCE_PATTERN, '');
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
  const visibleLines = stripFencedBlocks(unwrapMarkdownPresentationFence(content))
    .split('\n')
    .map(stripMarkdownSyntax)
    .filter(Boolean)
    .slice(0, HANDOFF_PREVIEW_LINE_COUNT);

  return truncate(visibleLines.join(' '));
}
