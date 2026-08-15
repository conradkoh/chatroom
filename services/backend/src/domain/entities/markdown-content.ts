import TurndownService from 'turndown';

const STRUCTURED_ENVELOPE_TAG_PATTERN = /<\/?(?:handoff-(?:overview|proofs|direction|ux|defragmentation|notes|action|details)|user-message|grounding|builder-handoff|planning-review-outcome)\b/i;
const LEGACY_HTML_TAG_PATTERN = /<\/?(?:p|div|span|strong|em|b|i|a|br|h[1-6]|ul|ol|li|table|tr|td|th|blockquote|pre|code)\b[^>]*>/i;
export function containsFencedCode(text: string) { return /```[\s\S]*?```/.test(text); }
export function containsStructuredEnvelope(text: string) { return STRUCTURED_ENVELOPE_TAG_PATTERN.test(text); }
export function looksLikeHtml(text: string) { const value = text.trim(); return !!value && !containsStructuredEnvelope(value) && !containsFencedCode(value) && LEGACY_HTML_TAG_PATTERN.test(value); }
export function stripHtmlTags(html: string) { return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); }
let turndown: TurndownService | undefined;
function getTurndown() { return (turndown ??= new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })); }
export function htmlToMarkdown(html: string) { try { const markdown = getTurndown().turndown(html).trim(); return markdown || stripHtmlTags(html); } catch { return stripHtmlTags(html); } }
export function normalizeMarkdownContent(input: string) { const value = input.trim(); return !value ? '' : looksLikeHtml(value) ? htmlToMarkdown(value) : value; }
export function withMarkdownContent<T extends { content: string }>(doc: T): T { return { ...doc, content: normalizeMarkdownContent(doc.content) }; }
