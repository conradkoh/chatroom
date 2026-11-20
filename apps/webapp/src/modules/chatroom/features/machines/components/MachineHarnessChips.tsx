'use client';

import { useMachineCapabilities } from '@/hooks/useMachineCapabilities';

/** Offline machines keep their last reported chips, dimmed and annotated. */
function chipAppearance(connected: boolean | undefined): { className: string; title?: string } {
  const isStale = connected === false;
  return {
    className: `flex flex-wrap gap-1${isStale ? ' opacity-60' : ''}`,
    title: isStale ? 'Last reported by the daemon' : undefined,
  };
}

/**
 * Harness chips for one machine, read from its daemon-pushed capability row.
 * Renders nothing while loading or when the daemon reported no harnesses.
 */
export function MachineHarnessChips({
  machineId,
  connected,
}: {
  machineId: string;
  connected: boolean | undefined;
}) {
  const { availableHarnesses, isLoading } = useMachineCapabilities(machineId);

  if (isLoading || availableHarnesses.length === 0) return null;

  const appearance = chipAppearance(connected);

  return (
    <div data-testid="machine-harness-chips" {...appearance}>
      {availableHarnesses.map((harness) => (
        <span
          key={harness}
          data-testid="machine-harness-chip"
          className="border border-chatroom-border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-chatroom-text-secondary"
        >
          {harness}
        </span>
      ))}
    </div>
  );
}
