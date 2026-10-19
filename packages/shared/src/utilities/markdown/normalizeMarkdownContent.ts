import TurndownService from 'turndown';

import { decodeHtmlEntities } from './decodeHtmlEntities';

/** Legacy editor and clipboard tags that mark a document as HTML. Matched case-insensitively, only at the start (after optional meta tags and comments). */
const LEGACY_HTML_START_PATTERN =
  /^(?:(?:<!--[\s\S]*?-->|<meta\b[^>]*>)\s*)*<(?:p|div|span|strong|em|b|i|a|br|h[1-6]|ul|ol|li|table|tr|td|th|blockquote|pre|code)\b[^>]*>/i;

/** Removes fenced blocks and inline code spans so HTML-like text inside code never counts. */
function stripCodeSpans(text: string) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

export function containsFencedCode(text: string) {
  return /```[\s\S]*?```/.test(text);
}
function looksLikeHtmlDecoded(value: string) {
  if (!value) return false;
  return LEGACY_HTML_START_PATTERN.test(stripCodeSpans(value).trimStart());
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
