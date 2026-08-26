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
