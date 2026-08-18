'use client';

import { useState } from 'react';

import {
  MarkdownEditor,
  MarkdownViewer,
  EditableMarkdown,
  defaultMarkdownEditorProseClassNames,
} from '@/components/markdown-editor';
import { markdownSurfaceModalProseClassNames } from '@/modules/chatroom/components/markdown-surface/markdownSurfacePresets';

const SAMPLE_MARKDOWN = `# Markdown WYSIWYG Demo

Edit this content in the editor and watch the live preview update.

## Features

- **Bold** and _italic_ text
- [Links](https://example.com) and lists
- Code blocks and tables

\`\`\`typescript
function greet(name: string) {
  return 'Hello!';
}
\`\`\`

| Feature | Status |
| ------- | ------ |
| Editor  | Ready  |
| Viewer  | Ready  |
`;

const STATIC_MARKDOWN = `## Read-only example

This panel uses **MarkdownViewer** only — no editor chrome.

- Pure display from a markdown string
- Same typography as MDX pages
`;

const EDITABLE_MARKDOWN = `## Editable demo

Click anywhere on this rendered markdown to open the WYSIWYG editor.

- Edit freely
- [Links still open](https://example.com) when clicked
- Save to persist, Cancel to discard
`;

export default function MarkdownEditorTestPage() {
  const [content, setContent] = useState(SAMPLE_MARKDOWN);
  const [editableContent, setEditableContent] = useState(EDITABLE_MARKDOWN);

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="max-w-6xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold mb-2 text-foreground">Markdown WYSIWYG Editor</h1>
          <p className="text-muted-foreground">
            TipTap-based editing with a separate read-only MarkdownViewer for downstream apps.
          </p>
        </div>

        <section className="border border-border rounded-lg bg-card p-6 space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Interactive Editor</h2>
          <p className="text-sm text-muted-foreground">
            Type in the editor below. Content is stored via onChange — defaultMarkdown is not
            rebound on every keystroke.
          </p>
          <MarkdownEditor
            defaultMarkdown={SAMPLE_MARKDOWN}
            onChange={setContent}
            placeholder="Start writing markdown..."
            proseClassName={`${defaultMarkdownEditorProseClassNames} ${markdownSurfaceModalProseClassNames}`}
          />
        </section>

        <section className="border border-border rounded-lg bg-card p-6 space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Click to Edit</h2>
          <p className="text-sm text-muted-foreground">
            Click the rendered markdown below to open the WYSIWYG editor. Save returns to a pristine
            read-only view with no editor chrome.
          </p>
          <EditableMarkdown
            markdown={editableContent}
            onChange={setEditableContent}
            placeholder="Click to add markdown..."
            proseClassName={defaultMarkdownEditorProseClassNames}
          />
        </section>

        <section className="border border-border rounded-lg bg-card p-6 space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Live Preview</h2>
          <p className="text-sm text-muted-foreground">
            Side-by-side editor and MarkdownViewer preview. Toggle dark mode to verify editor chrome
            theming.
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">Editor</h3>
              <MarkdownEditor
                defaultMarkdown={content}
                onChange={setContent}
                placeholder="Edit markdown..."
                proseClassName={defaultMarkdownEditorProseClassNames}
              />
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">Preview</h3>
              <div className="border border-border rounded-lg bg-card p-4 min-h-[238px]">
                <MarkdownViewer markdown={content} />
              </div>
            </div>
          </div>
        </section>

        <section className="border border-border rounded-lg bg-card p-6 space-y-4">
          <h2 className="text-xl font-semibold text-foreground">Standalone Viewer</h2>
          <p className="text-sm text-muted-foreground">
            Read-only MarkdownViewer with static markdown — no editor bundle required.
          </p>
          <div className="border border-border rounded-lg bg-card p-4">
            <MarkdownViewer markdown={STATIC_MARKDOWN} />
          </div>
        </section>
      </div>
    </div>
  );
}
