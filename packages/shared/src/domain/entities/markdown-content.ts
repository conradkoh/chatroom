import { normalizeMarkdownContent } from '../../utilities/markdown/normalizeMarkdownContent';

export {
  containsFencedCode,
  decodeHtmlEntities,
  htmlToMarkdown,
  looksLikeHtml,
  normalizeMarkdownContent,
  stripHtmlTags,
} from '../../utilities/markdown';
export function withMarkdownContent<T extends { content: string }>(doc: T): T {
  return { ...doc, content: normalizeMarkdownContent(doc.content) };
}
