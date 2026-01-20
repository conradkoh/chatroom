/**
 * MESSAGE RECEIVED section - shows the incoming message details.
 */

import { doubleSeparator } from '../formatters';
import type { PromptSection, TaskDeliveryContext } from '../types';

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
