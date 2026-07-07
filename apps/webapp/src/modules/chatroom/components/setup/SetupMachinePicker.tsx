'use client';

import { Monitor } from 'lucide-react';

import type { MachineInfo } from '../../types/machine';
import { getMachineDisplayName } from '../../types/machine';

interface SetupMachinePickerProps {
  machines: MachineInfo[];
  selectedMachineId: string | null;
  onSelectMachine: (machineId: string) => void;
}

export function SetupMachinePicker({
  machines,
  selectedMachineId,
  onSelectMachine,
}: SetupMachinePickerProps) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
        Machine
      </h3>
      <div className="flex flex-col gap-2">
        {machines.map((machine) => (
          <button
            key={machine.machineId}
            type="button"
            onClick={() => onSelectMachine(machine.machineId)}
            className={`flex items-center gap-3 p-3 border text-left transition-colors ${
              selectedMachineId === machine.machineId
                ? 'border-chatroom-accent bg-chatroom-bg-surface'
                : 'border-chatroom-border hover:border-chatroom-border-strong'
            }`}
          >
            <Monitor size={16} className="text-chatroom-text-muted flex-shrink-0" />
            <span className="text-sm font-medium text-chatroom-text-primary">
              {getMachineDisplayName(machine)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
