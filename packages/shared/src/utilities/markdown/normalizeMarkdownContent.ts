import TurndownService from 'turndown';

import { decodeHtmlEntities } from './decodeHtmlEntities';

/** Block-level legacy tags the old editor stored at the start of a document. Lowercase, case-sensitive. */
const LEGACY_HTML_BLOCK_START_PATTERN = /^<(?:p|div|ul|ol|h[1-6]|table|blockquote|pre)\b[^>]*>/;

/** Removes fenced blocks and inline code spans so HTML-like text inside code never counts. */
function stripCodeSpans(text: string) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

export function containsFencedCode(text: string) {
  return /```[\s\S]*?```/.test(text);
}
function looksLikeHtmlDecoded(value: string) {
  if (!value) return false;
  return LEGACY_HTML_BLOCK_START_PATTERN.test(stripCodeSpans(value).trimStart());
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
