import type { Message } from '../../types/message';

export function buildMessageMarkdownDownload(message: Message): string {
  const frontmatter = `---\nsender: ${message.senderRole}\ndate: ${new Date(message._creationTime).toISOString()}\n---\n\n`;
  return frontmatter + message.content;
}
