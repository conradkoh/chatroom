import { renderDeliveryAttachmentsBlock } from '@workspace/backend/prompts/attachments/render-delivery-attachments.js';

/**
 * Pure renderer for task-read output.
 *
 * @see ../../../../../../apps/webapp/src/modules/chatroom/attachments/ATTACHMENTS_GUIDE.md — attachment guide
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
  // fallow-ignore-next-line code-duplication
  attachedSnippets?: { reference: string; fileSource: string; selectedContent: string }[];
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

function renderAttachments(
  input: RenderTaskPromptInput,
  chatroomId: string,
  role: string
): string[] {
  return renderDeliveryAttachmentsBlock(
    {
      attachedBacklogItems: input.attachedBacklogItems,
      attachedSnippets: input.attachedSnippets,
    },
    { chatroomId, role, mode: 'task-read' }
  );
}

function renderDivergenceWarnings(input: RenderTaskPromptInput): string[] {
  const ctx = input.context;
  if (!ctx || !input.attachedBacklogItems || input.attachedBacklogItems.length === 0) return [];
  const attachedIds = input.attachedBacklogItems.map((i) => i._id);
  const divergentIds = detectBacklogDivergence(ctx.content, attachedIds);
  return divergentIds.map((id) => `⚠ Backlog ${id} diverges from context — confirm scope.`);
}

function renderStalenessNotice(elapsedHours: number): string[] {
  if (elapsedHours < 4) return [];
  const ageLabel =
    elapsedHours >= 48 ? `${Math.round(elapsedHours / 24)}d old` : `${elapsedHours}h old`;
  return [
    `<system-notice>`,
    `⚠️ Context is ${ageLabel}.`,
    `   Entry point role will update when needed.`,
    `</system-notice>`,
  ];
}

function renderContextSection(
  input: RenderTaskPromptInput,
  chatroomId: string,
  role: string
): string[] {
  const ctx = input.context;
  if (!ctx) return [];
  const lines: string[] = [
    '',
    'Background context (may be stale)',
    '<context>',
    ctx.content,
    '</context>',
  ];

  if (ctx.triggerMessageContent) {
    lines.push(
      `(For the message that triggered this context, run: chatroom context read --chatroom-id="${chatroomId}" --role="${role}")`
    );
  }

  lines.push(...renderStalenessNotice(ctx.elapsedHours));
  return lines;
}

export function renderTaskPrompt(input: RenderTaskPromptInput): string {
  const { taskId, status, content, chatroomId, role } = input;
  const lines: string[] = [];

  lines.push(`✅ Task content:`);
  lines.push(`   Task ID: ${taskId}`);
  lines.push(`   Status: ${status}`);

  if (input.context) {
    lines.push('On conflict, the message wins over background context.');
  }

  lines.push(...renderDivergenceWarnings(input));
  lines.push(`\n${content}`);
  lines.push(...renderAttachments(input, chatroomId, role));
  lines.push(...renderContextSection(input, chatroomId, role));

  return lines.join('\n');
}
