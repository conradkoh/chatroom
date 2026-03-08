import type { RemoteAgentService } from './remote-agent-service.js';

const registry = new Map<string, RemoteAgentService>();

/** Register a harness service. Call once per service at startup. */
export function registerHarness(service: RemoteAgentService): void {
  registry.set(service.id, service);
}

/** Get a harness service by ID. */
export function getHarness(id: string): RemoteAgentService | undefined {
  return registry.get(id);
}

/** Get all registered harness services. */
export function getAllHarnesses(): RemoteAgentService[] {
  return [...registry.values()];
}

/** Get all harness IDs (string array). */
export function getHarnessIds(): string[] {
  return [...registry.keys()];
}

/** Get only installed harness services. */
export function getInstalledHarnesses(): RemoteAgentService[] {
  return getAllHarnesses().filter((s) => s.isInstalled());
}
