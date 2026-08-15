import { Editor } from '@tiptap/core';
import { createMarkdownEditorExtensions } from './markdownEditorExtensions';

const STRUCTURED_ENVELOPE_TAG_PATTERN = /&lt;\/?(?:handoff-(?:overview|proofs|direction|ux|defragmentation|notes|action|details)|user-message|grounding|builder-handoff|planning-review-outcome)\b/i;
const LEGACY_HTML_TAG_PATTERN = /&lt;\/?(?:p|div|span|strong|em|b|i|a|br|h[1-6]|ul|ol|li|table|tr|td|th|blockquote|pre|code)\b[^&gt;]*&gt;/i;
export function containsFencedCode(text: string) { return /```[\s\S]*?```/.test(text); }
export function containsStructuredEnvelope(text: string) { return STRUCTURED_ENVELOPE_TAG_PATTERN.test(text); }
export function looksLikeHtml(text: string) { const trimmed = text.trim(); return !!trimmed && !containsStructuredEnvelope(trimmed) && !containsFencedCode(trimmed) && LEGACY_HTML_TAG_PATTERN.test(trimmed); }
export function stripHtmlTags(html: string) { return html.replace(/&lt;[^&gt;]+&gt;/g, '').replace(/\s+/g, ' ').trim(); }
export function htmlToMarkdown(html: string) {
  let editor: Editor | undefined;
  try { editor = new Editor({ extensions: createMarkdownEditorExtensions(), content: html, contentType: 'html' }); const md = editor.getMarkdown(); return md.trim() ? md : stripHtmlTags(html); }
  catch (error) { console.warn('[markdown-editor] htmlToMarkdown failed, using tag strip fallback', error); return stripHtmlTags(html); }
  finally { editor?.destroy(); }
}
export function normalizeMarkdownContent(input: string) { const trimmed = input.trim(); return !trimmed ? '' : looksLikeHtml(trimmed) ? htmlToMarkdown(trimmed) : trimmed; }
