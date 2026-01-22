/**
 * BACKLOG COMMANDS section - shows backlog CLI commands.
 * Only rendered for builder role.
 */

import { HANDOFF_DIR } from '../../config';
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
      `  mkdir -p ${HANDOFF_DIR}`,
      `  TASK_FILE="${HANDOFF_DIR}/task-$(date +%s%N).md"`,
      `  echo "Task description here" > "$TASK_FILE"`,
      `  chatroom backlog add ${ctx.chatroomId} --role=${ctx.role} --content-file="$TASK_FILE"\n`,
      `**Score a task (for prioritization):**`,
      `  chatroom backlog patch-task ${ctx.chatroomId} --role=${ctx.role} --task-id=<id> \\`,
      `    [--complexity=<low|medium|high>] [--value=<low|medium|high>] [--priority=<n>]`,
      `  - complexity: low = easy, high = complex/risky`,
      `  - value: low = nice-to-have, high = critical/high-impact`,
      `  - priority: numeric (higher = more important, sorted descending)\n`,
      `**Complete a task:**`,
      `  chatroom backlog complete ${ctx.chatroomId} --role=${ctx.role} --taskId=<id> [--force]`,
    ];

    return lines.join('\n');
  },
};
