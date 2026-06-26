/** Structured explorer file-snippet attachment for Cmd+I. */

export interface ExplorerSnippetAttachment {
  reference: string;
  fileSource: string;
  selectedContent: string;
}

/** Format reference ID from 1-based index: attachment-reference-001 */
function formatAttachmentReference(index: number): string {
  return `attachment-reference-${String(index).padStart(3, '0')}`;
}

/** Pick next unused reference given already-attached references in this compose session. */
function nextAttachmentReference(existingReferences: Iterable<string>): string {
  let max = 0;
  for (const ref of existingReferences) {
    const match = ref.match(/attachment-reference-(\d+)/);
    if (match?.[1]) max = Math.max(max, parseInt(match[1], 10));
  }
  return formatAttachmentReference(max + 1);
}

/** Create a snippet attachment from explorer selection. Trims selectedContent. */
export function createExplorerSnippetAttachment(
  fileSource: string,
  selectedContent: string,
  existingReferences?: Iterable<string>
): ExplorerSnippetAttachment {
  return {
    reference: nextAttachmentReference(existingReferences ?? []),
    fileSource,
    selectedContent: selectedContent.trim(),
  };
}

/** Render inline token for composer textarea. */
export function renderInlineReference(reference: string): string {
  return `[attachment: ${reference}]`;
}
