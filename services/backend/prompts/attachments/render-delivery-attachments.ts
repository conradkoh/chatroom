/**
 * Shared delivery attachment XML renderer.
 * @see ./ATTACHMENTS_GUIDE.md — end-to-end guide for implementing message attachments
 */
import { escapeXmlAttribute, escapeXmlText, xmlTextElement } from './xml.js';
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
    `  <attachment type="snippet" reference="${escapeXmlAttribute(snippet.reference)}">`,
    `  <snippet file-source="${escapeXmlAttribute(snippet.fileSource)}">`,
    `    <user-selected-content>`,
    escapeXmlText(snippet.selectedContent),
    `    </user-selected-content>`,
    `  </snippet>`,
    `  </attachment>`,
  ];
}

/** Agent-facing follow-up action attached to a rendered item. */
export interface DeliveryInteraction {
  type: 'command';
  text: string;
}

function renderInteractions(interactions: DeliveryInteraction[], indent: string): string[] {
  return [
    `${indent}<interactions>`,
    ...interactions.map(
      (i) =>
        `${indent}  <interaction type="${escapeXmlAttribute(i.type)}">${escapeXmlText(i.text)}</interaction>`
    ),
    `${indent}</interactions>`,
  ];
}

function renderBacklogAttachments(
  items: DeliveryBacklogItem[],
  ctx: DeliveryAttachmentRenderContext
): string[] {
  const lines: string[] = [];
  for (const item of items) {
    const id = escapeXmlAttribute(item._id);
    const chatroomId = escapeXmlAttribute(ctx.chatroomId);
    const role = escapeXmlAttribute(ctx.role);
    lines.push(`  <attachment type="backlog" backlog-item-id="${id}">`);
    lines.push(...xmlTextElement('content', item.content, '    '));
    lines.push(`    <hint>Work on this item.</hint>`);
    lines.push(
      ...renderInteractions(
        [
          {
            type: 'command',
            text: `Once this task is complete (implemented, verified end-to-end, PR raised for user review), run: chatroom backlog mark-for-review --chatroom-id="${chatroomId}" --role="${role}" --backlog-item-id=${id} — this moves the task to pending review. Do not use complete.`,
          },
        ],
        '    '
      )
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
    lines.push(`  <attachment type="task" task-id="${escapeXmlAttribute(item._id)}">`);
    lines.push(...xmlTextElement('content', item.content, '    '));
    lines.push(`    <hint>Referenced task attached by user.</hint>`);
    lines.push(`  </attachment>`);
  }
  return lines;
}

function renderMessageAttachments(items: DeliveryAttachedMessage[]): string[] {
  const lines: string[] = [];
  for (const item of items) {
    lines.push(`  <attachment type="message" message-id="${escapeXmlAttribute(item._id)}">`);
    lines.push(...xmlTextElement('sender-role', item.senderRole, '    '));
    lines.push(...xmlTextElement('content', item.content, '    '));
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
