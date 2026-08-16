import TurndownService from 'turndown';

import { decodeHtmlEntities } from './decodeHtmlEntities';

const LEGACY_HTML_TAG_PATTERN =
  /<\/?(?:p|div|span|strong|em|b|i|a|br|h[1-6]|ul|ol|li|table|tr|td|th|blockquote|pre|code)\b[^>]*>/i;
export function containsFencedCode(text: string) {
  return /```[\s\S]*?```/.test(text);
}
function looksLikeHtmlDecoded(value: string) {
  return !!value && !containsFencedCode(value) && LEGACY_HTML_TAG_PATTERN.test(value);
}
export function looksLikeHtml(text: string) {
  return looksLikeHtmlDecoded(decodeHtmlEntities(text.trim()));
}
export function stripHtmlTags(html: string) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
let turndown: TurndownService | undefined;
function getTurndown() {
  return (turndown ??= new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }));
}
export function htmlToMarkdown(html: string) {
  try {
    const markdown = getTurndown().turndown(html).trim();
    return markdown || stripHtmlTags(html);
  } catch {
    return stripHtmlTags(html);
  }
}
export function normalizeMarkdownContent(input: string) {
  const value = input.trim();
  if (!value) return '';
  const decoded = decodeHtmlEntities(value);
  return looksLikeHtmlDecoded(decoded) ? htmlToMarkdown(decoded) : decoded;
}
