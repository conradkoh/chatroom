/**
 * The machine a setup step selects by default. A chosen machine always wins. Otherwise the only
 * connected machine is selected. With none, or several and no choice, there is no default.
 */
export function pickDefaultMachineId(
  connected: readonly { machineId: string }[],
  chosen: string | null
): string | null {
  if (chosen !== null) return chosen;
  return connected.length === 1 ? connected[0].machineId : null;
}
