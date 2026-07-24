// fallow-ignore-next-line unused-export
export const WORKSPACE_TAB_DRAG_MIME = 'application/x-chatroom-workspace-tab';

export function setWorkspaceTabDragData(dataTransfer: DataTransfer, tabKey: string): void {
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData('text/plain', tabKey);
  dataTransfer.setData(WORKSPACE_TAB_DRAG_MIME, tabKey);
}

export function getWorkspaceTabDragKey(dataTransfer: DataTransfer): string | null {
  const key = dataTransfer.getData(WORKSPACE_TAB_DRAG_MIME) || dataTransfer.getData('text/plain');
  return key || null;
}

export function isWorkspaceTabDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes(WORKSPACE_TAB_DRAG_MIME);
}
