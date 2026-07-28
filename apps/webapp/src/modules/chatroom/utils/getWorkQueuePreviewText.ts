import { stripHandoffXmlTags } from './stripHandoffXmlTags';

export function getWorkQueuePreviewText(content: string): string {
  let text = stripHandoffXmlTags(content);
  text = text.replace(/^---MESSAGE---\s*/m, '');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
