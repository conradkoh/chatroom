'use client';

import { useCallback, useState, type ReactNode } from 'react';

import type {
  WorkspaceFileMenuHandlers,
  WorkspaceFileMenuState,
  WorkspaceFileMenuVisibility,
  WorkspaceFileMenuContentState,
} from './types';
import { WorkspaceFileMenuItems } from './WorkspaceFileMenuItems';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';

type MenuFrame = {
  relativePath: string;
  workingDir: string | null;
  nodeType?: WorkspaceFileMenuState['nodeType'];
  handlers: WorkspaceFileMenuHandlers;
  visibility: WorkspaceFileMenuVisibility;
};

// fallow-ignore-next-line complexity
export function useWorkspaceFileContextMenu(
  getMenuContentStateForPath?: (filePath: string) => WorkspaceFileMenuContentState
): {
  openAtPointer: (
    event: React.MouseEvent,
    props: {
      state: Pick<WorkspaceFileMenuState, 'relativePath' | 'workingDir' | 'nodeType'>;
      handlers: WorkspaceFileMenuHandlers;
      visibility: WorkspaceFileMenuVisibility;
    }
  ) => void;
  close: () => void;
  contextMenu: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [menuFrame, setMenuFrame] = useState<MenuFrame | null>(null);

  const openAtPointer = useCallback(
    (
      event: React.MouseEvent,
      props: {
        state: Pick<WorkspaceFileMenuState, 'relativePath' | 'workingDir' | 'nodeType'>;
        handlers: WorkspaceFileMenuHandlers;
        visibility: WorkspaceFileMenuVisibility;
      }
    ) => {
      event.preventDefault();
      event.stopPropagation();
      setPoint({ x: event.clientX, y: event.clientY });
      setMenuFrame({
        relativePath: props.state.relativePath,
        workingDir: props.state.workingDir,
        nodeType: props.state.nodeType,
        handlers: props.handlers,
        visibility: props.visibility,
      });
      setOpen(true);
    },
    []
  );

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const liveContentState =
    menuFrame && getMenuContentStateForPath
      ? getMenuContentStateForPath(menuFrame.relativePath)
      : ({} as WorkspaceFileMenuContentState);

  const contextMenu =
    open && menuFrame ? (
      <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            style={{
              position: 'fixed',
              left: point.x,
              top: point.y,
              width: 1,
              height: 1,
              pointerEvents: 'none',
            }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <WorkspaceFileMenuItems
            state={{
              relativePath: menuFrame.relativePath,
              workingDir: menuFrame.workingDir,
              nodeType: menuFrame.nodeType,
              ...liveContentState,
            }}
            handlers={menuFrame.handlers}
            visibility={menuFrame.visibility}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  return { openAtPointer, close, contextMenu };
}
