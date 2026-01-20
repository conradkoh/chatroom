/**
 * BACKLOG COMMANDS section - shows backlog CLI commands.
 * Only rendered for builder role.
 */

import type { PromptSection, TaskDeliveryContext } from '../types';

export const backlogCommandsSection: PromptSection = {
  id: 'backlog-commands',
  title: 'BACKLOG COMMANDS',
  icon: '📦',

  shouldRender: (ctx: TaskDeliveryContext): boolean => {
    return ctx.role.toLowerCase() === 'builder';
  },

  render: (ctx: TaskDeliveryContext): string => {
    const lines: string[] = [
      `If the user refers to the backlog or you need to check pending tasks:\n`,
      `**List tasks:**`,
      `  chatroom backlog list ${ctx.chatroomId} --role=${ctx.role} [--status=<status>] [--limit=<n>]`,
      `  Status: pending, in_progress, queued, backlog, completed, cancelled, active (default), all\n`,
      `**Add a task:**`,
      `  chatroom backlog add ${ctx.chatroomId} --role=${ctx.role} --content="<description>"\n`,
      `**Complete a task:**`,
      `  chatroom backlog complete ${ctx.chatroomId} --role=${ctx.role} --taskId=<id> [--force]`,
    ];

    return lines.join('\n');
  },
};
