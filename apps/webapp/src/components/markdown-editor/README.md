# Markdown Editor

Portable TipTap-based markdown editing primitives for downstream apps.

## Directory structure

- `components/` — MarkdownEditor, MarkdownViewer, EditableMarkdown, toolbar, and renderers.
- `hooks/` — editor lifecycle hook.
- `extensions/` — TipTap extension bundle.
- `utils/` — normalization, keyboard, markdown, and typography helpers.

## Usage

```tsx
import { MarkdownEditor, defaultMarkdownEditorProseClassNames } from '@/components/markdown-editor';

<MarkdownEditor
  defaultMarkdown="# Hello"
  onChange={setMarkdown}
  proseClassName={defaultMarkdownEditorProseClassNames}
  onCmdEnter={save}
/>;
```

`MarkdownEditor` provides WYSIWYG editing. `normalizeContent` can be injected for app-specific content boundaries; `fillHeight`, `placeholder`, and `initialClickCoords` support modal layouts.

`MarkdownViewer` is read-only rendering through react-markdown and remark-gfm:

```tsx
<MarkdownViewer markdown={markdown} />
```

`EditableMarkdown` provides click-to-edit with Save and Cancel:

```tsx
<EditableMarkdown
  markdown={markdown}
  onChange={setMarkdown}
  proseClassName={defaultMarkdownEditorProseClassNames}
/>
```

## Utilities

- `normalizeMarkdownContent` lossily converts legacy HTML to markdown.
- `getNormalizedEditorMarkdown` extracts normalized markdown from an editor.
- `defaultMarkdownEditorProseClassNames` is the generic typography preset.
- `isModEnterKey` detects Cmd/Ctrl+Enter.

The internal `useMarkdownEditor` hook owns TipTap lifecycle and `createMarkdownEditorExtensions` preserves blank lines. The demo is available at `/test/markdown-editor`.
