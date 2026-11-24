import { describe, expect, it } from 'vitest';

import { DOWNLOAD_FORMATS, downloadFileName, getDownloadFormat } from './downloadFormats';

describe('DOWNLOAD_FORMATS', () => {
  it('lists the formats in menu order: md, docx, pdf', () => {
    expect(DOWNLOAD_FORMATS.map((definition) => definition.format)).toEqual(['md', 'docx', 'pdf']);
  });

  it('defines the exact Markdown row', () => {
    expect(DOWNLOAD_FORMATS[0]).toEqual({
      format: 'md',
      label: 'Download as Markdown',
      busyLabel: null,
      failureMessage: 'Failed to save Markdown',
      extension: '.md',
      mimeType: 'text/markdown',
    });
  });

  it('defines the exact DOCX row', () => {
    expect(DOWNLOAD_FORMATS[1]).toEqual({
      format: 'docx',
      label: 'Download as DOCX',
      busyLabel: 'Preparing DOCX...',
      failureMessage: 'Failed to prepare DOCX',
      extension: '.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      saveDescription: 'Word Document',
    });
  });

  it('defines the exact PDF row', () => {
    expect(DOWNLOAD_FORMATS[2]).toEqual({
      format: 'pdf',
      label: 'Download as PDF',
      busyLabel: 'Preparing PDF...',
      failureMessage: 'Failed to prepare PDF',
      extension: '.pdf',
      mimeType: 'application/pdf',
      saveDescription: 'PDF Document',
    });
  });

  it('looks a definition up by format', () => {
    expect(getDownloadFormat('docx').label).toBe('Download as DOCX');
    expect(getDownloadFormat('pdf').mimeType).toBe('application/pdf');
  });

  it('keeps the picker save description on DOCX and PDF', () => {
    expect(getDownloadFormat('docx').saveDescription).toBe('Word Document');
    expect(getDownloadFormat('pdf').saveDescription).toBe('PDF Document');
  });
});

describe('downloadFileName', () => {
  it('keeps the markdown base name unchanged', () => {
    expect(downloadFileName('README.md', 'md')).toBe('README.md');
    expect(downloadFileName('docs/README.md', 'md')).toBe('README.md');
  });

  it('replaces the final extension for DOCX', () => {
    expect(downloadFileName('page.mdx', 'docx')).toBe('page.docx');
    expect(downloadFileName('docs/README.md', 'docx')).toBe('README.docx');
  });

  it('replaces only the final extension for PDF', () => {
    expect(downloadFileName('a.b.md', 'pdf')).toBe('a.b.pdf');
  });

  it('appends the extension when the base name has none', () => {
    expect(downloadFileName('NOTES', 'docx')).toBe('NOTES.docx');
  });
});
