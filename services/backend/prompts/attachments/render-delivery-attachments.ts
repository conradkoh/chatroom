/**
 * Shared delivery attachment XML renderer.
 * @see ./ATTACHMENTS_GUIDE.md — end-to-end guide for implementing message attachments
 */
import type {
  DeliveryAttachmentsInput,
  DeliveryAttachmentRenderContext,
  DeliveryBacklogItem,
  DeliverySnippet,
  MessageAttachmentKind,
} from '../../src/domain/entities/message-attachments.js';

/** Per-kind renderer signature */
export type AttachmentRenderer<K extends MessageAttachmentKind> = (
  items: K extends 'backlog'
    ? DeliveryBacklogItem[]
    : K extends 'snippet'
      ? DeliverySnippet[]
      : never,
  ctx: DeliveryAttachmentRenderContext
) => string[];

function renderSnippetAttachment(snippet: DeliverySnippet): string[] {
  return [
    `  <attachment reference="${snippet.reference}">`,
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
    lines.push(`  <attachment type="backlog-item">`);
    lines.push(`    - [${item.status.toUpperCase()}] ${item.content}`);
    lines.push(`      ID: ${item._id}`);
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

/** Exhaustive renderer map — compiler errors if a kind is missing. */
// fallow-ignore-next-line unused-export
export const DELIVERY_ATTACHMENT_RENDERERS: {
  [K in MessageAttachmentKind]: AttachmentRenderer<K>;
} = {
  backlog: renderBacklogAttachments,
  snippet: renderSnippetAttachments,
  message: () => [], // task-read does not render message attachments in <attachments> block; Phase 2 may wire separately
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
  const snippetLines = input.attachedSnippets?.length
    ? DELIVERY_ATTACHMENT_RENDERERS.snippet(input.attachedSnippets, ctx)
    : [];
  if (backlogLines.length === 0 && snippetLines.length === 0) return [];

  return ['', '<attachments>', ...backlogLines, ...snippetLines, '</attachments>'];
}

/** Convenience: join lines into a single string (empty string when no attachments). */
// fallow-ignore-next-line unused-export
export function renderDeliveryAttachments(
  input: DeliveryAttachmentsInput,
  ctx: DeliveryAttachmentRenderContext
): string {
  return renderDeliveryAttachmentsBlock(input, ctx).join('\n');
}
