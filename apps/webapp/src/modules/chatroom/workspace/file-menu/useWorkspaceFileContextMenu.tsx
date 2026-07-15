'use client';

import { useCallback, useState, type ReactNode } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { WorkspaceFileMenuItems } from './WorkspaceFileMenuItems';
import type { WorkspaceFileMenuProps } from './types';

export function useWorkspaceFileContextMenu(): {
  openAtPointer: (event: React.MouseEvent, props: WorkspaceFileMenuProps) => void;
  close: () => void;
  contextMenu: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [menuProps, setMenuProps] = useState<WorkspaceFileMenuProps | null>(null);

  const openAtPointer = useCallback((event: React.MouseEvent, props: WorkspaceFileMenuProps) => {
    event.preventDefault();
    event.stopPropagation();
    setPoint({ x: event.clientX, y: event.clientY });
    setMenuProps(props);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const contextMenu = open ? (
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
        {menuProps && <WorkspaceFileMenuItems {...menuProps} />}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  return { openAtPointer, close, contextMenu };
}
