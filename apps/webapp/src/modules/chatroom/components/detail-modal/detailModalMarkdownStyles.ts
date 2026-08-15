const proseSelectableInlineCodeClassNames =
  'prose-code:before:content-none prose-code:after:content-none';

export const detailModalParagraphClassNames = 'my-2';
export const detailModalSpacerParagraphClassNames = 'my-2 min-h-[1.5em]';
export const detailModalInlineCodeClassNames =
  'bg-chatroom-bg-tertiary px-1 text-chatroom-text-primary text-sm break-words whitespace-pre-wrap [overflow-wrap:anywhere] before:content-none after:content-none';
export const detailModalFencedCodePreClassNames =
  'bg-chatroom-bg-secondary border-2 border-chatroom-border p-4 overflow-x-hidden whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-xs text-chatroom-text-primary font-mono';
export const detailModalFencedCodeBlockClassNames = 'relative group not-prose mb-3';
export const detailModalProseMirrorCodeClassNames =
  '[&_.ProseMirror_code]:bg-chatroom-bg-tertiary [&_.ProseMirror_code]:px-1 [&_.ProseMirror_code]:text-chatroom-text-primary [&_.ProseMirror_code]:text-sm [&_.ProseMirror_code]:break-words [&_.ProseMirror_code]:whitespace-pre-wrap [&_.ProseMirror_pre]:bg-chatroom-bg-secondary [&_.ProseMirror_pre]:border-2 [&_.ProseMirror_pre]:border-chatroom-border [&_.ProseMirror_pre]:p-4 [&_.ProseMirror_pre]:my-3 [&_.ProseMirror_pre]:overflow-x-hidden [&_.ProseMirror_pre]:whitespace-pre-wrap [&_.ProseMirror_pre]:break-words [&_.ProseMirror_pre]:text-xs [&_.ProseMirror_pre]:rounded-none';

export const detailModalProseClassNames =
  'text-chatroom-text-primary text-sm leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-bold prose-headings:mt-4 prose-headings:mb-2 prose-headings:text-chatroom-text-primary prose-p:my-2 prose-p:text-chatroom-text-primary prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary prose-code:text-chatroom-text-primary prose-code:bg-chatroom-bg-tertiary prose-code:px-1 prose-li:text-chatroom-text-primary prose-pre:bg-chatroom-bg-secondary prose-pre:border-2 prose-pre:border-chatroom-border prose-pre:my-3 prose-pre:rounded-none break-words [overflow-wrap:anywhere] min-w-0 prose-code:break-words prose-code:whitespace-pre-wrap prose-pre:whitespace-pre-wrap prose-pre:break-words prose-pre:overflow-x-hidden ' +
  proseSelectableInlineCodeClassNames;

export const detailModalMarkdownProseClassNames = `${detailModalProseClassNames} ${detailModalProseMirrorCodeClassNames}`;
export const detailModalRichTextEditorProseClassNames = detailModalMarkdownProseClassNames;
