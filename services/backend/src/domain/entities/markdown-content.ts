import TurndownService from 'turndown';

const STRUCTURED_ENVELOPE_TAG_PATTERN = /<\/?(?:handoff-(?:overview|proofs|direction|ux|defragmentation|notes|action|details)|user-message|grounding|builder-handoff|planning-review-outcome)\b/i;
const LEGACY_HTML_TAG_PATTERN = /<\/?(?:p|div|span|strong|em|b|i|a|br|h[1-6]|ul|ol|li|table|tr|td|th|blockquote|pre|code)\b[^>]*>/i;
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00A0' };
function decodeHtmlEntities(input: string, maxPasses = 3): string {
  let result = input;
  for (let pass = 0; pass < maxPasses; pass++) {
    const previous = result;
    result = result.replace(/&(?:amp;)?(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body: string) => {
      if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(parseInt(body.slice(2), 16));
      if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
      return NAMED_ENTITIES[body] ?? match;
    });
    if (result === previous) break;
  }
  return result;
}
export function containsFencedCode(text: string) { return /```[\s\S]*?```/.test(text); }
export function containsStructuredEnvelope(text: string) { return STRUCTURED_ENVELOPE_TAG_PATTERN.test(text); }
function looksLikeHtmlDecoded(value: string) { return !!value && !containsStructuredEnvelope(value) && !containsFencedCode(value) && LEGACY_HTML_TAG_PATTERN.test(value); }
export function looksLikeHtml(text: string) { return looksLikeHtmlDecoded(decodeHtmlEntities(text.trim())); }
export function stripHtmlTags(html: string) { return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
let turndown: TurndownService | undefined;
function getTurndown() { return (turndown ??= new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })); }
export function htmlToMarkdown(html: string) { try { const markdown = getTurndown().turndown(html).trim(); return markdown || stripHtmlTags(html); } catch { return stripHtmlTags(html); } }
export function normalizeMarkdownContent(input: string) { const value = input.trim(); if (!value) return ''; const decoded = decodeHtmlEntities(value); return containsStructuredEnvelope(decoded) ? decoded : looksLikeHtmlDecoded(decoded) ? htmlToMarkdown(decoded) : decoded; }
export function withMarkdownContent<T extends { content: string }>(doc: T): T { return { ...doc, content: normalizeMarkdownContent(doc.content) }; }
