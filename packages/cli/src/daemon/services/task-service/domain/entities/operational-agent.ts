export type TaskOperationalAgent = {
  operationalState: 'running' | 'stopped' | 'starting' | 'circuit_open';
  stopState?: 'idle' | 'pending' | 'stopping' | 'stopped' | 'failed' | undefined;
};

export function isOperationalDesiredRunning(row: TaskOperationalAgent | undefined): boolean {
  return row?.operationalState === 'running' || row?.operationalState === 'starting';
}

export function isOperationalCircuitOpen(row: TaskOperationalAgent | undefined): boolean {
  return row?.operationalState === 'circuit_open';
}

export function isOperationalStopIntentActive(row: TaskOperationalAgent | undefined): boolean {
  return row?.stopState === 'stopped' || row?.stopState === 'stopping' || row?.stopState === 'pending';
}
