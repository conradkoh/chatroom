/**
 * Shared delivery attachment XML renderer.
 * @see ./ATTACHMENTS_GUIDE.md — end-to-end guide for implementing message attachments
 */
import type {
  DeliveryAttachedMessage,
  DeliveryAttachmentsInput,
  DeliveryAttachmentRenderContext,
  DeliveryBacklogItem,
  DeliverySnippet,
  DeliveryTaskItem,
  MessageAttachmentKind,
} from '../../src/domain/entities/message-attachments.js';

/** Per-kind renderer signature */
export type AttachmentRenderer<K extends MessageAttachmentKind> = (
  items: K extends 'backlog'
    ? DeliveryBacklogItem[]
    : K extends 'snippet'
      ? DeliverySnippet[]
      : K extends 'task'
        ? DeliveryTaskItem[]
        : K extends 'message'
          ? DeliveryAttachedMessage[]
          : never,
  ctx: DeliveryAttachmentRenderContext
) => string[];

function renderSnippetAttachment(snippet: DeliverySnippet): string[] {
  return [
    `  <attachment type="snippet" reference="${snippet.reference}">`,
    `  <snippet file-source="${snippet.fileSource}">`,
    `    <user-selected-content>`,
    snippet.selectedContent,
    `    </user-selected-content>`,
    `  </snippet>`,
    `  </attachment>`,
  ];
}

function renderBacklogAttachments(
  items: DeliveryBacklogItem[],
  ctx: DeliveryAttachmentRenderContext
): string[] {
  const lines: string[] = [];
  for (const item of items) {
    lines.push(`  <attachment type="backlog" backlog-item-id="${item._id}">`);
    lines.push(`    - [${item.status.toUpperCase()}] ${item.content}`);
    lines.push(
      `    <hint>Work on this item. When done: chatroom backlog mark-for-review --chatroom-id="${ctx.chatroomId}" --role="${ctx.role}" --backlog-item-id=${item._id}</hint>`
    );
    lines.push(`  </attachment>`);
  }
  return lines;
}

function renderSnippetAttachments(snippets: DeliverySnippet[]): string[] {
  const lines: string[] = [];
  for (const snippet of snippets) {
    lines.push(...renderSnippetAttachment(snippet));
  }
  return lines;
}

function renderTaskAttachments(
  items: DeliveryTaskItem[],
  _ctx: DeliveryAttachmentRenderContext
): string[] {
  const lines: string[] = [];
  for (const item of items) {
    lines.push(`  <attachment type="task" task-id="${item._id}">`);
    lines.push(`    - [${item.status.toUpperCase()}] ${item.content}`);
    lines.push(`    <hint>Referenced task attached by user.</hint>`);
    lines.push(`  </attachment>`);
  }
  return lines;
}

function renderMessageAttachments(items: DeliveryAttachedMessage[]): string[] {
  const lines: string[] = [];
  for (const item of items) {
    lines.push(`  <attachment type="message" message-id="${item._id}">`);
    lines.push(`    From: ${item.senderRole}`);
    lines.push(`    ---`);
    lines.push(`    ${item.content}`);
    lines.push(`  </attachment>`);
  }
  return lines;
}

/** Exhaustive renderer map — compiler errors if a kind is missing. */
// fallow-ignore-next-line unused-export
export const DELIVERY_ATTACHMENT_RENDERERS: {
  [K in MessageAttachmentKind]: AttachmentRenderer<K>;
} = {
  backlog: renderBacklogAttachments,
  snippet: renderSnippetAttachments,
  message: renderMessageAttachments,
  task: renderTaskAttachments,
};

/** Returns lines including leading blank line + <attachments> wrapper, or [] when empty. */
// fallow-ignore-next-line complexity
export function renderDeliveryAttachmentsBlock(
  input: DeliveryAttachmentsInput,
  ctx: DeliveryAttachmentRenderContext
): string[] {
  const backlogLines = input.attachedBacklogItems?.length
    ? DELIVERY_ATTACHMENT_RENDERERS.backlog(input.attachedBacklogItems, ctx)
    : [];
  const taskLines = input.attachedTasks?.length
    ? DELIVERY_ATTACHMENT_RENDERERS.task(input.attachedTasks, ctx)
    : [];
  const messageLines = input.attachedMessages?.length
    ? DELIVERY_ATTACHMENT_RENDERERS.message(input.attachedMessages, ctx)
    : [];
  const snippetLines = input.attachedSnippets?.length
    ? DELIVERY_ATTACHMENT_RENDERERS.snippet(input.attachedSnippets, ctx)
    : [];
  if (
    backlogLines.length === 0 &&
    taskLines.length === 0 &&
    messageLines.length === 0 &&
    snippetLines.length === 0
  ) {
    return [];
  }

  return [
    '',
    '<attachments>',
    ...backlogLines,
    ...taskLines,
    ...messageLines,
    ...snippetLines,
    '</attachments>',
  ];
}

/** Convenience: join lines into a single string (empty string when no attachments). */
// fallow-ignore-next-line unused-export
export function renderDeliveryAttachments(
  input: DeliveryAttachmentsInput,
  ctx: DeliveryAttachmentRenderContext
): string {
  return renderDeliveryAttachmentsBlock(input, ctx).join('\n');
}
