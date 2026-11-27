'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';

import { closeUnlessModified } from '../../lib/closeUnlessModified';
import { IMPORT_MACHINE_HELP_COPY } from '../../lib/transferCopy';

import { InlineFeedback } from '@/components/inline-feedback';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { MachineRowModel } from '@/modules/chatroom/features/machines/hooks/useMachineRows';

interface ImportMachinePickerProps {
  machines: MachineRowModel[];
  machinesLoading: boolean;
  machineId: string | null;
  onChoose(machineId: string): void;
  /** Called on a plain click of the register link; modified clicks keep the dialog open. */
  onClose(): void;
}

/** Target-machine radios. Online and offline are both selectable. */
// fallow-ignore-next-line complexity
export function ImportMachinePicker({
  machines,
  machinesLoading,
  machineId,
  onChoose,
  onClose,
}: ImportMachinePickerProps) {
  usePreselectOnlyMachine(machines, machineId, onChoose);
  const selected = machines.find((row) => row.machine.machineId === machineId);

  return (
    <section aria-labelledby="import-machine-heading" className="space-y-2">
      <h3
        id="import-machine-heading"
        className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted"
      >
        Import to machine
      </h3>
      <p className="text-xs text-chatroom-text-muted">{IMPORT_MACHINE_HELP_COPY}</p>
      {machinesLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 rounded-none" />
          ))}
        </div>
      ) : machines.length === 0 ? (
        <p className="text-xs text-chatroom-text-muted">
          No machines registered. Import needs a machine to attach the chatroom's folders to.{' '}
          <Link
            href="/app/machines"
            className="font-bold text-chatroom-accent hover:underline"
            onClick={(event) => closeUnlessModified(event, onClose)}
          >
            Register a machine
          </Link>
          . Leaving this page discards the loaded file.
        </p>
      ) : (
        <RadioGroup
          value={machineId ?? ''}
          onValueChange={onChoose}
          aria-labelledby="import-machine-heading"
          className="gap-0 border border-chatroom-border divide-y divide-chatroom-border"
        >
          {machines.map((row) => (
            <MachineRadio key={row.machine.machineId} row={row} />
          ))}
        </RadioGroup>
      )}
      {selected !== undefined && selected.connected === false && (
        <InlineFeedback
          feedback={{
            id: 1,
            tone: 'info',
            message: `${selected.displayName} is offline. The chatrooms are created now; agents cannot start until its daemon runs.`,
          }}
        />
      )}
    </section>
  );
}

/** One machine row: online, offline and still-checking are all selectable. */
// fallow-ignore-next-line complexity
function MachineRadio({ row }: { row: MachineRowModel }) {
  const online = row.connected === true;
  const status = row.connected === undefined ? 'Checking…' : online ? 'Online' : 'Offline';
  return (
    <label
      data-testid="import-machine"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 hover:bg-chatroom-bg-hover"
    >
      <RadioGroupItem
        value={row.machine.machineId}
        className="size-4 rounded-none border-2 border-chatroom-border-strong bg-chatroom-bg-secondary data-checked:border-chatroom-accent data-checked:bg-chatroom-accent"
      />
      <span
        aria-hidden
        className={cn(
          'size-2 shrink-0',
          online ? 'bg-chatroom-status-success' : 'bg-chatroom-text-muted'
        )}
      />
      <span className="min-w-0 truncate text-xs font-bold uppercase tracking-wide">
        {row.displayName}
      </span>
      <span className="min-w-0 truncate font-mono text-[10px] text-chatroom-text-muted">
        {row.machine.hostname}
      </span>
      <span
        className={cn(
          'ml-auto text-[10px] font-bold uppercase',
          online ? 'text-chatroom-status-success' : 'text-chatroom-text-muted'
        )}
      >
        {status}
      </span>
    </label>
  );
}

/** One owned machine is the only possible target, so choose it once. */
function usePreselectOnlyMachine(
  machines: readonly MachineRowModel[],
  machineId: string | null,
  onChoose: (machineId: string) => void
): void {
  const preselectedRef = useRef(false);
  useEffect(() => {
    if (preselectedRef.current || machines.length !== 1 || machineId !== null) return;
    preselectedRef.current = true;
    onChoose(machines[0].machine.machineId);
  }, [machineId, machines, onChoose]);
}
