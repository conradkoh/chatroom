export type MarkdownEditorProps = {
  /** Markdown source only; legacy HTML is normalized lossily before callbacks. */
  defaultMarkdown?: string;
  /** Called with markdown-only content changes. */
  onChange?: (markdown: string) => void;
  /** Placeholder when empty. */
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  onCmdEnter?: () => void;
  initialClickCoords?: { left: number; top: number } | null;
  /** Stretch editor content to fill flex parent (modal layouts). Default false. */
  fillHeight?: boolean;
};

export type MarkdownViewerProps = {
  markdown: string;
  className?: string;
};

export type EditableMarkdownProps = {
  /** Markdown source only (controlled). */
  markdown: string;
  /** Called when user saves edited content. */
  onChange: (markdown: string) => void;
  /** Optional callback after save (receives saved markdown). */
  onSave?: (markdown: string) => void;
  /** Optional callback when user cancels editing. */
  onCancel?: () => void;
  /** Placeholder shown in empty view mode and in editor. */
  placeholder?: string;
  className?: string;
};
