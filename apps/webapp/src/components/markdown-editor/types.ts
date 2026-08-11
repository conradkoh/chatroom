import type { MDXEditorProps } from '@mdxeditor/editor';

export type MarkdownEditorProps = {
  /** Initial markdown content. Avoid rebinding on every onChange. */
  defaultMarkdown?: string;
  /** Called when content changes. */
  onChange?: (markdown: string) => void;
  /** Placeholder when empty. */
  placeholder?: string;
  className?: string;
  readOnly?: never;
} & Omit<MDXEditorProps, 'markdown' | 'onChange' | 'readOnly' | 'plugins'>;

export type MarkdownViewerProps = {
  markdown: string;
  className?: string;
};

export type EditableMarkdownProps = {
  /** Current markdown content (controlled). */
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
