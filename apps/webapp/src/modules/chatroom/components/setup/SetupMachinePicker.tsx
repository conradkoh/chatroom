'use client';

import { Monitor } from 'lucide-react';

import type { UserMachine } from '../../types/machine';
import { getMachineDisplayName } from '../../types/machine';

interface SetupMachinePickerProps {
  machines: UserMachine[];
  selectedMachineId: string | null;
  onSelectMachine: (machineId: string) => void;
  /** Machines that cannot be selected. They render dimmed with an "Offline" label. */
  disabledMachineIds?: ReadonlySet<string>;
}

function machineRowClassName(disabled: boolean, selected: boolean): string {
  const state = disabled
    ? 'border-chatroom-border opacity-50 cursor-not-allowed'
    : selected
      ? 'border-chatroom-accent bg-chatroom-bg-surface'
      : 'border-chatroom-border hover:border-chatroom-border-strong';
  return `flex items-center gap-3 p-3 border text-left transition-colors ${state}`;
}

function MachineRow({
  machine,
  selected,
  disabled,
  onSelect,
}: {
  machine: UserMachine;
  selected: boolean;
  disabled: boolean;
  onSelect: (machineId: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled ? 'true' : undefined}
      onClick={() => onSelect(machine.machineId)}
      className={machineRowClassName(disabled, selected)}
    >
      <Monitor size={16} className="text-chatroom-text-muted flex-shrink-0" />
      <span className="text-sm font-medium text-chatroom-text-primary">
        {getMachineDisplayName(machine)}
      </span>
      {disabled && (
        <span className="ml-auto text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Offline
        </span>
      )}
    </button>
  );
}

export function SetupMachinePicker({
  machines,
  selectedMachineId,
  onSelectMachine,
  disabledMachineIds,
}: SetupMachinePickerProps) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
        Machine
      </h3>
      <div className="flex flex-col gap-2">
        {machines.map((machine) => (
          <MachineRow
            key={machine.machineId}
            machine={machine}
            selected={selectedMachineId === machine.machineId}
            disabled={disabledMachineIds?.has(machine.machineId) ?? false}
            onSelect={onSelectMachine}
          />
        ))}
      </div>
    </div>
  );
}
