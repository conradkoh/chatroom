import { normalizeMarkdownContent } from '@/components/markdown-editor/normalizeMarkdownContent';
import { HANDOFF_XML_TAGS } from './handoffXmlTags';
const HANDOFF_XML_TAG_PATTERN = new RegExp('&lt;/?(?:' + HANDOFF_XML_TAGS.join('|') + ')\\b', 'i');
export function containsStructuredEnvelope(text: string): boolean { return HANDOFF_XML_TAG_PATTERN.test(text); }
export function normalizeChatroomMarkdownContent(input: string) { const value = input.trim(); return !value || containsStructuredEnvelope(value) ? value : normalizeMarkdownContent(value); }
