import { Pencil, Trash2, type LucideIcon } from 'lucide-react';

export interface MachineAction {
  /** Extend this union to add e.g. 'update-daemon' later. */
  id: 'rename' | 'delete';
  label: string;
  icon: LucideIcon;
  destructive?: boolean;
  onSelect(): void;
}

/** Ordered action list for a machine card. Destructive actions render after a separator. */
export function buildMachineActions(handlers: {
  onRename(): void;
  onDelete(): void;
}): MachineAction[] {
  return [
    { id: 'rename', label: 'Rename', icon: Pencil, onSelect: handlers.onRename },
    {
      id: 'delete',
      label: 'Delete machine…',
      icon: Trash2,
      destructive: true,
      onSelect: handlers.onDelete,
    },
  ];
}
