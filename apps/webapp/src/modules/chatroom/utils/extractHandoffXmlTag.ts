export function extractHandoffXmlTag(
  content: string,
  tag: string
): { body: string | null; hadOpen: boolean; hadClose: boolean } {
  const openRe = new RegExp(`<${tag}\\s*>`, 'i');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
  const hadOpen = openRe.test(content);
  const hadClose = closeRe.test(content);
  const match = new RegExp(`<${tag}\\s*>([\\s\\S]*?)</${tag}\\s*>`, 'i').exec(content);
  return { body: match ? match[1].trim() : null, hadOpen, hadClose };
}
