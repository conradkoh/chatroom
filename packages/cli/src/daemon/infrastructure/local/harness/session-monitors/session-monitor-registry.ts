import type { HarnessSessionMonitor } from '../../../../domain/entities/session-monitor.js';

const registry = new Map<string, HarnessSessionMonitor>();

export function registerSessionMonitor(harnessId: string, monitor: HarnessSessionMonitor): void {
  registry.set(harnessId, monitor);
}

export function getSessionMonitor(harnessId: string): HarnessSessionMonitor | undefined {
  return registry.get(harnessId);
}

export function getAllSessionMonitors(): Map<string, HarnessSessionMonitor> {
  return new Map(registry);
}
