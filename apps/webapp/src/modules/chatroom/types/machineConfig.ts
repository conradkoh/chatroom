import type { AgentHarness } from './machine';

export interface MachineConfigEntry {
  agentHarness: AgentHarness;
  model: string;
}

export function buildMachineConfigKey(entry: MachineConfigEntry): string {
  return `${entry.agentHarness}|${entry.model}`;
}

export function entriesEqual(a: MachineConfigEntry, b: MachineConfigEntry): boolean {
  return a.agentHarness === b.agentHarness && a.model === b.model;
}
