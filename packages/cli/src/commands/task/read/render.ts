import { renderDeliveryAttachmentsBlock } from '@workspace/backend/prompts/attachments/render-delivery-attachments.js';

/**
 * Pure renderer for task-read output.
 *
 * @see @workspace/backend/prompts/attachments/ATTACHMENTS_GUIDE.md — attachment guide
 *
 * Layout (top to bottom):
 * 1. Header (task ID, status)
 * 2. User message body
 * 3. Attachments block (if any)
 */

export interface RenderTaskPromptInput {
  taskId: string;
  status: string;
  content: string;
  chatroomId: string;
  role: string;
  attachedBacklogItems?: { _id: string; content: string; status: string }[] | undefined;
  // fallow-ignore-next-line code-duplication
  attachedSnippets?:
    { reference: string; fileSource: string; selectedContent: string }[] | undefined;
  attachedTasks?: { _id: string; content: string; status: string }[] | undefined;
  attachedMessages?: { _id: string; content: string; senderRole: string }[] | undefined;
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
      attachedTasks: input.attachedTasks,
      attachedMessages: input.attachedMessages,
    },
    { chatroomId, role, mode: 'task-read' }
  );
}

export function renderTaskPrompt(input: RenderTaskPromptInput): string {
  const { taskId, status, content, chatroomId, role } = input;
  const lines: string[] = [];

  lines.push(`✅ Task content:`);
  lines.push(`   Task ID: ${taskId}`);
  lines.push(`   Status: ${status}`);
  lines.push(`\n${content}`);
  lines.push(...renderAttachments(input, chatroomId, role));

  return lines.join('\n');
}
