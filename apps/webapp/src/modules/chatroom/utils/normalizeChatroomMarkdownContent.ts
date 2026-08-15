import { HANDOFF_XML_TAGS } from './handoffXmlTags';

import { normalizeMarkdownContent } from '@/components/markdown-editor/normalizeMarkdownContent';

const HANDOFF_XML_TAG_PATTERN = new RegExp('</?(?:' + HANDOFF_XML_TAGS.join('|') + ')\\b', 'i');

function containsStructuredEnvelope(text: string): boolean {
  return HANDOFF_XML_TAG_PATTERN.test(text);
}

export function normalizeChatroomMarkdownContent(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (containsStructuredEnvelope(trimmed)) return trimmed;
  return normalizeMarkdownContent(trimmed);
}
