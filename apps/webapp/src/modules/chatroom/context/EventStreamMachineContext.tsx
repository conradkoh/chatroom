'use client';

import { createContext, useContext } from 'react';

export interface MachineNameEntry {
  hostname: string;
  alias?: string;
}

const EventStreamMachineContext = createContext<Map<string, MachineNameEntry> | undefined>(
  undefined
);

export function useEventStreamMachine(machineId?: string): MachineNameEntry | undefined {
  const map = useContext(EventStreamMachineContext);
  if (!map || !machineId) return undefined;
  return map.get(machineId);
}

export function useEventStreamMachineMap(): Map<string, MachineNameEntry> | undefined {
  return useContext(EventStreamMachineContext);
}

export const EventStreamMachineProvider = EventStreamMachineContext.Provider;
