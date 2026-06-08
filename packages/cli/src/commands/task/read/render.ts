/**
 * Pure renderer for task-read output.
 *
 * Extracted from index.ts so the rendering logic can be tested
 * and restructured independently of command plumbing.
 *
 * Layout (top to bottom):
 * 1. Header (task ID, status)
 * 2. Precedence line (if context present)
 * 3. Divergence warning (if attached IDs differ from context IDs)
 * 4. User message body
 * 5. Attachments block (if any)
 * 6. Background context block (if any) — demoted below the message
 */

export interface RenderTaskPromptInput {
  taskId: string;
  status: string;
  content: string;
  chatroomId: string;
  role: string;
  context?: {
    content: string;
    triggerMessageContent?: string;
    triggerMessageSenderRole?: string;
    elapsedHours: number;
  };
  attachedBacklogItems?: { _id: string; content: string; status: string }[];
}

/**
 * Detect which attached backlog IDs diverge from the pinned context.
 *
 * An ID diverges when it does NOT appear as a substring in the context content.
 */
export function detectBacklogDivergence(
  contextContent: string | undefined,
  attachedIds: string[]
): string[] {
  if (!contextContent || attachedIds.length === 0) {
    return [];
  }

  return attachedIds.filter((id) => !contextContent.includes(id));
}

export function renderTaskPrompt(input: RenderTaskPromptInput): string {
  const { taskId, status, content, chatroomId, role } = input;
  const lines: string[] = [];

  // 1. Header
  lines.push(`✅ Task content:`);
  lines.push(`   Task ID: ${taskId}`);
  lines.push(`   Status: ${status}`);

  // 2. Precedence line (only when context exists — no context means nothing to conflict with)
  if (input.context) {
    lines.push('On conflict, the message wins over background context.');
  }

  // 3. Divergence warning for attached backlog IDs not matching context
  if (input.context && input.attachedBacklogItems && input.attachedBacklogItems.length > 0) {
    const attachedIds = input.attachedBacklogItems.map((i) => i._id);
    const divergentIds = detectBacklogDivergence(input.context.content, attachedIds);
    for (const id of divergentIds) {
      lines.push(`⚠ Backlog ${id} diverges from context — confirm scope.`);
    }
  }

  // 4. User message body
  lines.push(`\n${content}`);

  // 5. Attachments
  if (input.attachedBacklogItems && input.attachedBacklogItems.length > 0) {
    lines.push('');
    lines.push('<attachments>');
    for (const item of input.attachedBacklogItems) {
      lines.push(`  <attachment type="backlog-item">`);
      lines.push(`    - [${item.status.toUpperCase()}] ${item.content}`);
      lines.push(`      ID: ${item._id}`);
      lines.push(
        `    <hint>Work on this item. When done: chatroom backlog mark-for-review --chatroom-id="${chatroomId}" --role="${role}" --backlog-item-id=${item._id}</hint>`
      );
      lines.push(`  </attachment>`);
    }
    lines.push('</attachments>');
  }

  // 6. Background context (demoted, relabeled)
  if (input.context) {
    lines.push('');
    lines.push('Background context (may be stale)');
    lines.push('<context>');
    lines.push(input.context.content);
    lines.push('</context>');

    if (input.context.triggerMessageContent) {
      // The originating message is intentionally NOT inlined. Run the context command
      // to retrieve the full context and the message that triggered it.
      lines.push(
        `(For the message that triggered this context, run: chatroom context read --chatroom-id="${chatroomId}" --role="${role}")`
      );
    }

    // Staleness notice (time-based): soft warning at >= 4h, hard at >= 24h.
    const hoursAgo = Math.round(input.context.elapsedHours);
    if (hoursAgo >= 4) {
      const ageLabel =
        hoursAgo >= 48
          ? `${Math.round(hoursAgo / 24)}d old`
          : hoursAgo >= 24
            ? `${hoursAgo}h old`
            : `${hoursAgo}h old`;
      lines.push(`<system-notice>`);
      lines.push(`⚠️ Context is ${ageLabel}.`);
      lines.push(`   Entry point role will update when needed.`);
      lines.push(`</system-notice>`);
    }
  }

  return lines.join('\n');
}
