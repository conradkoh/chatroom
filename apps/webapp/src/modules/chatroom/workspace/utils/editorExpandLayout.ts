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
