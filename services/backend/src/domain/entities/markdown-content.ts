import {
  containsFencedCode,
  decodeHtmlEntities,
  htmlToMarkdown,
  looksLikeHtml as sharedLooksLikeHtml,
  normalizeMarkdownContent as sharedNormalizeMarkdownContent,
  stripHtmlTags,
} from '@workspace/shared/utilities/markdown';

const STRUCTURED_ENVELOPE_TAG_PATTERN =
  /<\/?(?:handoff-(?:overview|proofs|direction|ux|defragmentation|notes|action|details)|user-message|grounding|builder-handoff|planning-review-outcome)\b/i;

export function containsStructuredEnvelope(text: string) {
  return STRUCTURED_ENVELOPE_TAG_PATTERN.test(text);
}

export { containsFencedCode, decodeHtmlEntities, htmlToMarkdown, stripHtmlTags };

export function looksLikeHtml(text: string) {
  const decoded = decodeHtmlEntities(text.trim());
  return containsStructuredEnvelope(decoded) ? false : sharedLooksLikeHtml(decoded);
}

export function normalizeMarkdownContent(input: string) {
  const value = input.trim();
  if (!value) return '';
  const decoded = decodeHtmlEntities(value);
  if (containsStructuredEnvelope(decoded)) return decoded;
  return sharedNormalizeMarkdownContent(decoded);
}

export function withMarkdownContent<T extends { content: string }>(doc: T): T {
  return { ...doc, content: normalizeMarkdownContent(doc.content) };
}
