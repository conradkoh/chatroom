'use client';

import { MachineCard } from './MachineCard';
import type { MachineRowModel } from '../hooks/useMachineRows';

/** Ordered machine cards. Order comes from useMachineRows (display name only). */
export function MachineList({ rows }: { rows: MachineRowModel[] }) {
  return (
    <ul className="space-y-3" data-testid="machine-list">
      {rows.map((row) => (
        <MachineCard key={row.machine.machineId} row={row} />
      ))}
    </ul>
  );
}
