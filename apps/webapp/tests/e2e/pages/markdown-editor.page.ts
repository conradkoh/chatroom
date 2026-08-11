import { expect, type Locator, type Page } from '@playwright/test';

import { BasePage } from './base.page';

export class MarkdownEditorTestPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  private sectionByName(name: string): Locator {
    return this.page
      .locator('section')
      .filter({ has: this.page.getByRole('heading', { name, level: 2 }) });
  }

  get pageHeading(): Locator {
    return this.page.getByRole('heading', { name: 'Markdown WYSIWYG Editor', level: 1 });
  }

  get interactiveEditorSection(): Locator {
    return this.sectionByName('Interactive Editor');
  }

  get livePreviewSection(): Locator {
    return this.sectionByName('Live Preview');
  }

  get standaloneViewerSection(): Locator {
    return this.sectionByName('Standalone Viewer');
  }

  get clickToEditSection(): Locator {
    return this.sectionByName('Click to Edit');
  }

  get clickToEditView(): Locator {
    return this.clickToEditSection.locator('[aria-label="Edit markdown"]');
  }

  get clickToEditSaveButton(): Locator {
    return this.clickToEditSection.getByRole('button', { name: 'Save' });
  }

  get clickToEditCancelButton(): Locator {
    return this.clickToEditSection.getByRole('button', { name: 'Cancel' });
  }

  get interactiveEditor(): Locator {
    return this.interactiveEditorSection.locator('.mdxeditor');
  }

  get interactiveToolbar(): Locator {
    return this.interactiveEditor.locator('.mdxeditor-toolbar');
  }

  get interactiveEditorEditable(): Locator {
    return this.interactiveEditor.getByLabel('editable markdown', { exact: true });
  }

  get interactiveCodeMirrorEditors(): Locator {
    return this.interactiveEditor.locator('.cm-editor');
  }

  get insertCodeBlockButton(): Locator {
    return this.interactiveEditor.getByRole('button', { name: 'Insert Code Block' });
  }

  get livePreviewViewer(): Locator {
    return this.livePreviewSection.locator('article.mdx-content');
  }

  get standaloneViewer(): Locator {
    return this.standaloneViewerSection.locator('article.mdx-content');
  }

  override async navigate(path = '/test/markdown-editor'): Promise<void> {
    await this.page.goto(path);
    await expect(this.pageHeading).toBeVisible();
    await expect(this.interactiveEditor).toBeVisible({ timeout: 15_000 });
  }
}
