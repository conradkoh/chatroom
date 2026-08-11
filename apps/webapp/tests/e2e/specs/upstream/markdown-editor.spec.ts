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
    await expect(markdownPage.insertCodeBlockButton).toBeVisible();
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

  test('existing code blocks are editable without runtime errors', async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));

    const markdownPage = new MarkdownEditorTestPage(page);
    await markdownPage.navigate();

    const firstCodeEditor = markdownPage.interactiveCodeMirrorEditors.first();
    const codeContent = firstCodeEditor.locator('.cm-content');
    await expect(codeContent).toBeVisible({ timeout: 15_000 });
    await codeContent.click();
    await expect(codeContent).toBeFocused();

    await page.keyboard.insertText('E2E-CODE-777');
    await expect(markdownPage.livePreviewViewer).toContainText('E2E-CODE-777');

    expect(runtimeErrors.some((message) => message.includes('No CodeBlockEditor registered'))).toBe(
      false
    );
    await expect(page.getByText('No CodeBlockEditor registered')).toHaveCount(0);
  });

  test('inserting a code block adds an editable CodeMirror editor', async ({ page }) => {
    const markdownPage = new MarkdownEditorTestPage(page);
    await markdownPage.navigate();

    const codeEditors = markdownPage.interactiveCodeMirrorEditors;
    await expect(codeEditors.first().locator('.cm-content')).toBeVisible({ timeout: 15_000 });
    const before = await codeEditors.count();
    await markdownPage.insertCodeBlockButton.click();
    await expect(codeEditors).toHaveCount(before + 1);
    await expect(codeEditors.nth(before).locator('.cm-content')).toBeVisible();
  });

  test('click to edit: view → edit → save returns to pristine rendered view', async ({ page }) => {
    const markdownPage = new MarkdownEditorTestPage(page);
    await markdownPage.navigate();

    const view = markdownPage.clickToEditView;
    await expect(view).toBeVisible();

    // Click view area (not a link) to enter edit mode
    await view.click();
    await expect(markdownPage.clickToEditSaveButton).toBeVisible();
    await expect(markdownPage.clickToEditSection.locator('.mdxeditor')).toBeVisible();

    // Type unique marker in editor
    const editable = markdownPage.clickToEditSection.getByLabel('editable markdown', {
      exact: true,
    });
    await editable.click();
    await page.keyboard.insertText(' E2E-EDITABLE-MARKER');

    // Save — editor chrome should disappear, marker visible in rendered view
    await markdownPage.clickToEditSaveButton.click();
    await expect(markdownPage.clickToEditSection.locator('.mdxeditor')).toHaveCount(0);
    await expect(view).toContainText('E2E-EDITABLE-MARKER');
  });
});
