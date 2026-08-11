'use client';

import '@mdxeditor/editor/style.css';

import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  linkPlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  CodeMirrorEditor,
  ChangeCodeMirrorLanguage,
  ConditionalContents,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  ListsToggle,
  BlockTypeSelect,
  CreateLink,
  InsertCodeBlock,
  InsertTable,
  InsertThematicBreak,
  type MDXEditorMethods,
  type MDXEditorProps,
} from '@mdxeditor/editor';
import { useTheme } from 'next-themes';
import type { ForwardedRef } from 'react';

import './markdown-editor-theme.css';

export default function InitializedMDXEditor({
  editorRef,
  ...props
}: { editorRef: ForwardedRef<MDXEditorMethods> | null } & MDXEditorProps) {
  const { resolvedTheme } = useTheme();

  return (
    <MDXEditor
      className={
        resolvedTheme === 'dark' ? 'dark-theme markdown-editor-theme' : 'markdown-editor-theme'
      }
      plugins={[
        headingsPlugin(),
        listsPlugin(),
        quotePlugin(),
        thematicBreakPlugin(),
        markdownShortcutPlugin(),
        linkPlugin(),
        tablePlugin(),
        codeBlockPlugin({
          defaultCodeBlockLanguage: 'txt',
          codeBlockEditorDescriptors: [
            { priority: -10, match: () => true, Editor: CodeMirrorEditor },
          ],
        }),
        codeMirrorPlugin({
          codeBlockLanguages: {
            '': 'Plain Text',
            txt: 'Plain Text',
            js: 'JavaScript',
            ts: 'TypeScript',
            typescript: 'TypeScript',
            tsx: 'TypeScript (React)',
            jsx: 'JavaScript (React)',
            css: 'CSS',
            markdown: 'Markdown',
          },
        }),
        toolbarPlugin({
          toolbarContents: () => (
            <ConditionalContents
              options={[
                {
                  when: (editor) => editor?.editorType === 'codeblock',
                  contents: () => <ChangeCodeMirrorLanguage />,
                },
                {
                  fallback: () => (
                    <>
                      <UndoRedo />
                      <BoldItalicUnderlineToggles />
                      <ListsToggle />
                      <BlockTypeSelect />
                      <CreateLink />
                      <InsertCodeBlock />
                      <InsertTable />
                      <InsertThematicBreak />
                    </>
                  ),
                },
              ]}
            />
          ),
        }),
      ]}
      contentEditableClassName="prose dark:prose-invert max-w-none min-h-[200px] px-4 py-3"
      {...props}
      ref={editorRef}
    />
  );
}
