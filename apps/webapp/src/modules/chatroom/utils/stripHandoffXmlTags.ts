import { HANDOFF_XML_TAGS } from './handoffXmlTags';

export function stripHandoffXmlTags(content: string): string {
  let result = content.replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of HANDOFF_XML_TAGS) {
    const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'gi');
    const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
    result = result.replace(openRe, '').replace(closeRe, '');
  }
  return result.replace(/\n{3,}/g, '\n\n').trim();
}
