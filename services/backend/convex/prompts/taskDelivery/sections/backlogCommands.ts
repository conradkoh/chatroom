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
      `  chatroom backlog list ${ctx.chatroomId} --role=${ctx.role} --status=active --full [--limit=<n>]`,
      `  Status: active (default), pending, in_progress, queued, backlog, completed, cancelled, pending_review, archived, all (requires --limit)\n`,
      `**Add a task:**`,
      `  echo "Task description here" > /tmp/task.md`,
      `  chatroom backlog add ${ctx.chatroomId} --role=${ctx.role} --content-file=/tmp/task.md\n`,
      `**Complete a task:**`,
      `  chatroom backlog complete ${ctx.chatroomId} --role=${ctx.role} --taskId=<id> [--force]`,
    ];

    return lines.join('\n');
  },
};
