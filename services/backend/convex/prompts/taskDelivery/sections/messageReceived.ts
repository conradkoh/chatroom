/**
 * MESSAGE RECEIVED section - shows the incoming message details.
 */

import { doubleSeparator } from '../formatters';
import type { PromptSection, TaskDeliveryContext } from '../types';

/**
 * Format the current timestamp into a human-readable format.
 * Example: "Jan 22, 2026 at 2:35 PM UTC"
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

export const messageReceivedSection: PromptSection = {
  id: 'message-received',
  title: 'MESSAGE RECEIVED',
  icon: '📨',

  shouldRender: () => true,

  render: (ctx: TaskDeliveryContext): string => {
    const senderRole = ctx.message?.senderRole || ctx.task.createdBy;
    const messageType = ctx.message?.type || 'message';
    const targetRole = ctx.message?.targetRole;
    const displayContent = ctx.message?.content || ctx.task.content;

    const lines: string[] = [
      doubleSeparator(),
      `📨 MESSAGE RECEIVED`,
      doubleSeparator(),
      `Current Time: ${formatTimestamp(ctx.currentTimestamp)}`,
      `From: ${senderRole}`,
      `Type: ${messageType}`,
    ];

    if (targetRole) {
      lines.push(`To: ${targetRole}`);
    }

    lines.push(`\n📄 Content:\n${displayContent}`);

    return lines.join('\n');
  },
};
