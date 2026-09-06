import { decodeHtmlEntities, normalizeMarkdownContent } from '@workspace/shared/utilities/markdown';

import { HANDOFF_XML_TAGS } from './handoffXmlTags';

const HANDOFF_XML_TAG_PATTERN = new RegExp('</?(?:' + HANDOFF_XML_TAGS.join('|') + ')\\b', 'i');

function containsStructuredEnvelope(text: string): boolean {
  return HANDOFF_XML_TAG_PATTERN.test(text);
}

export function normalizeChatroomMarkdownContent(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  const decoded = decodeHtmlEntities(trimmed);
  if (containsStructuredEnvelope(decoded)) return decoded;
  return normalizeMarkdownContent(decoded);
}

/**
 * Removes one outer markdown presentation fence from agent-submitted handoffs.
 * This is display-only: the persisted/task content remains unchanged.
 *
 * Accepted wrapper:
 *   ```markdown or ```md   (case-insensitive, whitespace around the line allowed)
 *   ...
 *   ```                     (final nonblank line)
 *
 * Inner fenced blocks and all non-matching input remain unchanged.
 */
export function unwrapMarkdownPresentationFence(input: string): string {
  const match = input
    .trim()
    .match(/^```(?:markdown|md)\b[ \t]*\r?\n([\s\S]*?)(?:\r?\n)?```[ \t]*$/i);
  if (!match) return input;
  return match[1].trim();
}
