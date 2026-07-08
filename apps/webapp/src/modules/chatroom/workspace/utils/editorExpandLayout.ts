export function isEditorExpanded(
  hasSplit: boolean,
  expandedTabPath: string | null,
  activeTabPath: string | null
): boolean {
  return hasSplit && expandedTabPath !== null && expandedTabPath === activeTabPath;
}

export function editorPaneFlexClass(isEditorExpanded: boolean, hasSplit: boolean): string {
  if (!hasSplit) return 'flex-1';
  return isEditorExpanded ? 'flex-[9]' : 'flex-1';
}

export function previewPaneFlexClass(isEditorExpanded: boolean): string {
  return isEditorExpanded ? 'flex-[1]' : 'flex-1';
}
