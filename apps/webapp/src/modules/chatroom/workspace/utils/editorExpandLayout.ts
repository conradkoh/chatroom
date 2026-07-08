export type ExpandPane = 'editor' | 'preview';

export function isEditorExpanded(
  hasSplit: boolean,
  expandedTabPath: string | null,
  expandedPane: ExpandPane | null,
  activeTabPath: string | null
): boolean {
  return (
    hasSplit &&
    expandedTabPath !== null &&
    expandedPane === 'editor' &&
    expandedTabPath === activeTabPath
  );
}

export function isPreviewExpanded(
  hasSplit: boolean,
  expandedTabPath: string | null,
  expandedPane: ExpandPane | null,
  activeTabPath: string | null
): boolean {
  return (
    hasSplit &&
    expandedTabPath !== null &&
    expandedPane === 'preview' &&
    expandedTabPath === activeTabPath
  );
}

export function editorPaneFlexClass(
  isEditorExpanded: boolean,
  isPreviewExpanded: boolean,
  hasSplit: boolean
): string {
  if (!hasSplit) return 'flex-1';
  if (isEditorExpanded) return 'flex-[9]';
  if (isPreviewExpanded) return 'flex-[1]';
  return 'flex-1';
}

export function previewPaneFlexClass(
  isEditorExpanded: boolean,
  isPreviewExpanded: boolean
): string {
  if (isPreviewExpanded) return 'flex-[9]';
  if (isEditorExpanded) return 'flex-[1]';
  return 'flex-1';
}
