import type { Message } from '../../types/message';

export function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function messageExportFilename(message: Message, ext: string): string {
  const role = message.senderRole ?? 'message';
  const ts = new Date(message._creationTime).toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `chatroom-${role}-${ts}.${ext}`;
}
