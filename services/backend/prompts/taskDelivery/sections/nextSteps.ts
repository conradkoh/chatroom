/**
 * NEXT STEPS section - shows what commands to run next.
 */

import { HANDOFF_DIR } from '../../config';
import { formatReminder } from '../formatters';
import type { PromptSection, TaskDeliveryContext } from '../types';

export const nextStepsSection: PromptSection = {
  id: 'next-steps',
  title: 'NEXT STEPS',
  icon: '📝',

  shouldRender: () => true,

  render: (ctx: TaskDeliveryContext): string => {
    const senderRole = ctx.message?.senderRole || ctx.task.createdBy;
    const needsClassification =
      ctx.rolePrompt.currentClassification === null && senderRole.toLowerCase() === 'user';

    const lines: string[] = [];

    if (needsClassification) {
      lines.push(`\n1️⃣ First, classify this user message:\n`);
      lines.push(`  chatroom task-started ${ctx.chatroomId} \\`);
      lines.push(`    --role=${ctx.role} \\`);
      lines.push(`    --classification=<question|new_feature|follow_up>\n`);
      lines.push(`   Options:`);
      lines.push(`     question    - User asking a question`);
      lines.push(`     new_feature - New feature request (requires review)`);
      lines.push(`     follow_up   - Follow-up to previous task\n`);
      lines.push(`2️⃣ When your task is complete, run:\n`);
    } else {
      lines.push(`When your task is complete, run:\n`);
    }

    lines.push(`  # Write message to file first:`);
    lines.push(`  # mkdir -p ${HANDOFF_DIR} && echo "<summary>" > ${HANDOFF_DIR}/message.md`);
    lines.push(`  chatroom handoff ${ctx.chatroomId} \\`);
    lines.push(`    --role=${ctx.role} \\`);
    lines.push(`    --message-file="${HANDOFF_DIR}/message.md" \\`);
    lines.push(`    --next-role=<target>\n`);

    lines.push(formatReminder(ctx.chatroomId, ctx.role));

    return lines.join('\n');
  },
};
