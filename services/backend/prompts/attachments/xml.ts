/** Escape text placed between XML tags (&, <, >). */
export function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape values placed inside double-quoted XML attributes (&, <, >, "). */
export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, '&quot;');
}

/** Render one element with escaped text body. Returns lines with indent prefix. */
export function xmlTextElement(tag: string, content: string, indent = '    '): string[] {
  if (!content.includes('\n')) {
    return [`${indent}<${tag}>${escapeXmlText(content)}</${tag}>`];
  }
  return [`${indent}<${tag}>`, escapeXmlText(content), `${indent}</${tag}>`];
}
