import { expect, test } from '@playwright/test';

import { MarkdownEditorTestPage } from '../../pages/markdown-editor.page';
import { TAG_MARKDOWN, TAG_UPSTREAM } from '../../support/tags';
import { UPSTREAM_FLOWS } from '../../support/upstream-flows';

test.describe('Markdown Editor Demo', { tag: [TAG_UPSTREAM, TAG_MARKDOWN] }, () => {
  test(`covers upstream flow: ${UPSTREAM_FLOWS.markdownEditor.path}`, async ({ page }) => {
    const markdownPage = new MarkdownEditorTestPage(page);
    await markdownPage.navigate();

    await expect(markdownPage.pageHeading).toBeVisible();
    await expect(markdownPage.interactiveEditorSection).toBeVisible();
    await expect(markdownPage.livePreviewSection).toBeVisible();
    await expect(markdownPage.standaloneViewerSection).toBeVisible();
    await expect(markdownPage.clickToEditSection).toBeVisible();

    await expect(markdownPage.interactiveEditor).toBeVisible();
    await expect(markdownPage.interactiveToolbar).toBeVisible();
    await expect(markdownPage.interactiveToolbar).toBeVisible();
    await expect(markdownPage.interactiveEditorEditable).toBeVisible();
  });

  test('live preview renders every markdown element from the sample', async ({ page }) => {
    const markdownPage = new MarkdownEditorTestPage(page);
    await markdownPage.navigate();

    const viewer = markdownPage.livePreviewViewer;
    await expect(
      viewer.getByRole('heading', { level: 1, name: 'Markdown WYSIWYG Demo' })
    ).toBeVisible();
    await expect(viewer.getByRole('heading', { level: 2, name: 'Features' })).toBeVisible();
    await expect(
      viewer.getByText('Edit this content in the editor and watch the live preview update.')
    ).toBeVisible();
    await expect(viewer.locator('li').filter({ hasText: 'Bold' })).toBeVisible();
    await expect(viewer.locator('li').filter({ hasText: 'Links' })).toBeVisible();
    await expect(viewer.locator('li').filter({ hasText: 'Code blocks' })).toBeVisible();
    await expect(viewer.getByRole('link', { name: 'Links' })).toHaveAttribute(
      'href',
      'https://example.com'
    );
    await expect(viewer.locator('pre code.language-typescript')).toContainText('function greet');
    await expect(viewer.getByRole('columnheader', { name: 'Feature' })).toBeVisible();
    await expect(viewer.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(viewer.getByRole('cell', { name: 'Editor' })).toBeVisible();
    await expect(viewer.getByRole('cell', { name: 'Viewer' })).toBeVisible();
    await expect(viewer.getByRole('cell', { name: 'Ready' })).toHaveCount(2);
  });

  test('standalone viewer renders the static markdown', async ({ page }) => {
    const markdownPage = new MarkdownEditorTestPage(page);
    await markdownPage.navigate();

    const viewer = markdownPage.standaloneViewer;
    await expect(
      viewer.getByRole('heading', { level: 2, name: 'Read-only example' })
    ).toBeVisible();
    await expect(viewer.locator('strong', { hasText: 'MarkdownViewer' })).toBeVisible();
    await expect(viewer.locator('li').filter({ hasText: 'Pure display' })).toBeVisible();
    await expect(viewer.locator('li').filter({ hasText: 'Same typography' })).toBeVisible();
  });

  test('interactive editor applies default prose classes to EditorContent wrapper', async ({
    page,
  }) => {
    const markdownPage = new MarkdownEditorTestPage(page);
    await markdownPage.navigate();
    const editor = markdownPage.interactiveEditor;
    await expect(editor).toBeVisible();
    const wrapper = editor.locator('.p-4');
    await expect(wrapper).toHaveClass(/prose/);
    await expect(wrapper).toHaveClass(/prose-invert/);
  });

  test('extends selection upward from final soft-wrap tail in code block', async ({ page }) => {
    const markdownPage = new MarkdownEditorTestPage(page);
    await markdownPage.navigate();

    const repro =
      '[<div class="px-4 py-8 text-...">No files found. Ensure the workspace daemon is running.</div> in WorkspaceFileExplorer (at .../WorkspaceFileExplorer.tsx:68:12) in FileExplorerPanel (at .../FileExplorerPanel.tsx:494:13) in next in ChatroomDashboard (at .../ChatroomDashboard.tsx:1909:25)]';
    const editable = markdownPage.interactiveEditorEditable;
    const code = editable.locator('pre code').first();

    await code.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      (node.closest('[contenteditable="true"]') as HTMLElement | null)?.focus();
    });
    await page.keyboard.insertText(repro);
    await expect(code).toHaveText(repro);

    await code.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.keyboard.press('Shift+Alt+ArrowUp');

    const selection = await code.evaluate((node) => {
      const current = window.getSelection();
      const anchorNode = current?.anchorNode;
      const focusNode = current?.focusNode;
      return {
        isCollapsed: current?.isCollapsed ?? true,
        selectedText: current?.toString() ?? '',
        anchorInsideCode: anchorNode ? node.contains(anchorNode) : false,
        focusInsideCode: focusNode ? node.contains(focusNode) : false,
      };
    });

    expect(selection.isCollapsed).toBe(false);
    expect(selection.selectedText.length).toBeGreaterThan(0);
    expect(selection.anchorInsideCode).toBe(true);
    expect(selection.focusInsideCode).toBe(true);
  });

  test('toolbar bold toggle applies formatting', async ({ page }) => {
    const markdownPage = new MarkdownEditorTestPage(page);
    await markdownPage.navigate();
    const editor = markdownPage.livePreviewSection.getByTestId('markdown-editor');
    const editable = editor.locator('.ProseMirror');
    await editable.click();
    const boldButton = editor.locator('button[title="Bold"]');
    await boldButton.click();
    await editable.click();
    await page.keyboard.type('Bold E2E marker');
    await expect(editable).toContainText('Bold E2E marker');
    await expect(boldButton).toHaveClass(/bg-muted/);
  });

  test('click to edit: view → edit → save returns to pristine rendered view', async ({ page }) => {
    const markdownPage = new MarkdownEditorTestPage(page);
    await markdownPage.navigate();

    const view = markdownPage.clickToEditView;
    await expect(view).toBeVisible();

    // Click view area (not a link) to enter edit mode
    await view.click();
    await expect(markdownPage.clickToEditSaveButton).toBeVisible();
    await expect(markdownPage.clickToEditSection.getByTestId('markdown-editor')).toBeVisible();

    // Type unique marker in editor
    const editable = markdownPage.clickToEditSection.locator('.ProseMirror');
    await editable.click();
    await page.keyboard.insertText(' E2E-EDITABLE-MARKER');

    // Save — editor chrome should disappear, marker visible in rendered view
    await markdownPage.clickToEditSaveButton.click();
    await expect(markdownPage.clickToEditSection.getByTestId('markdown-editor')).toHaveCount(0);
    await expect(view).toContainText('E2E-EDITABLE-MARKER');
  });
});
