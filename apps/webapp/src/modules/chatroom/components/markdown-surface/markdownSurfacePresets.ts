import {
  proseSelectableInlineCodeClassNames,
  markdownSurfaceProseMirrorCodeClassNames,
} from './markdownSurfaceTokens';
export const markdownSurfaceBaseProseClassNames =
  'text-chatroom-text-primary text-sm leading-relaxed break-words prose dark:prose-invert prose-sm max-w-none prose-headings:font-bold prose-headings:mt-4 prose-headings:mb-2 prose-headings:text-chatroom-text-primary prose-p:my-2 prose-p:text-chatroom-text-primary prose-table:border-collapse prose-th:bg-chatroom-bg-tertiary prose-th:border-2 prose-th:border-chatroom-border prose-th:px-3 prose-th:py-2 prose-td:border-2 prose-td:border-chatroom-border prose-td:px-3 prose-td:py-2 prose-blockquote:border-l-2 prose-blockquote:border-chatroom-status-info prose-blockquote:bg-chatroom-bg-tertiary prose-blockquote:text-chatroom-text-secondary prose-code:text-chatroom-text-primary prose-code:bg-chatroom-bg-tertiary prose-code:px-1 prose-li:text-chatroom-text-primary prose-pre:bg-chatroom-bg-secondary prose-pre:border-2 prose-pre:border-chatroom-border prose-pre:my-3 prose-pre:rounded-none break-words [overflow-wrap:anywhere] min-w-0 prose-code:break-words prose-code:whitespace-pre-wrap prose-pre:whitespace-pre-wrap prose-pre:break-words prose-pre:overflow-x-hidden ' +
  proseSelectableInlineCodeClassNames;
export const markdownSurfaceFeedDensityClassNames =
  'text-[13px] overflow-x-hidden prose-table:block prose-table:overflow-x-auto prose-table:w-fit prose-table:max-w-full';
export const markdownSurfaceFeedProseClassNames = `${markdownSurfaceBaseProseClassNames} ${markdownSurfaceFeedDensityClassNames}`;
export const markdownSurfaceModalProseClassNames = `${markdownSurfaceBaseProseClassNames} ${markdownSurfaceProseMirrorCodeClassNames}`;
export const markdownSurfaceRichTextEditorProseClassNames = markdownSurfaceModalProseClassNames;
export const markdownSurfaceTaskOverlayProseClassNames =
  'prose-code:text-chatroom-status-success prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.9em] prose-ul:my-2 prose-ol:my-2 prose-li:my-0';
export const markdownSurfaceInlineEventProseClassNames =
  'text-[11px] text-chatroom-text-primary prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-headings:my-1 prose-li:my-0 prose-ul:my-1 prose-ol:my-1 ' +
  proseSelectableInlineCodeClassNames;
