export function previewTabDoubleClickAction(
  viewType: 'preview' | 'table',
  activeTabPath: string | null
): { action: 'togglePreviewExpanded'; filePath: string } | null {
  if (viewType === 'preview' && activeTabPath) {
    return { action: 'togglePreviewExpanded', filePath: activeTabPath };
  }
  return null;
}

export function fileTabDoubleClickExpandAction(
  isPinned: boolean,
  filePath: string
): { action: 'toggleEditorExpanded'; filePath: string } | { action: 'pin'; filePath: string } {
  if (isPinned) return { action: 'toggleEditorExpanded', filePath };
  return { action: 'pin', filePath };
}
