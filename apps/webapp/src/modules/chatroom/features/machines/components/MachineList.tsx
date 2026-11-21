'use client';

import { MachineCard } from './MachineCard';
import type { MachineRowModel } from '../hooks/useMachineRows';

/** Ordered machine cards. Order comes from useMachineRows (display name only). */
export function MachineList({
  rows,
  expandedMachineId,
  onToggle,
}: {
  rows: MachineRowModel[];
  /** Single-expand accordion: only this card renders its body. */
  expandedMachineId: string | null;
  onToggle: (machineId: string) => void;
}) {
  return (
    <ul className="space-y-3" data-testid="machine-list">
      {rows.map((row) => (
        <MachineCard
          key={row.machine.machineId}
          row={row}
          expanded={row.machine.machineId === expandedMachineId}
          onToggle={() => onToggle(row.machine.machineId)}
        />
      ))}
    </ul>
  );
}
