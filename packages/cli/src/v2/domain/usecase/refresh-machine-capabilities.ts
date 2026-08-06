export type RefreshMachineCapabilitiesOutcome =
  | { kind: 'noop' }
  | { kind: 'skipped_no_changes' }
  | { kind: 'pushed' }
  | { kind: 'failed'; message: string };

export interface MachineCapabilitiesRefreshPort {
  refresh(): Promise<RefreshMachineCapabilitiesOutcome>;
}

export interface BackgroundCapabilitiesDiscoveryPort {
  start(): void;
}

export interface RefreshMachineCapabilitiesDeps {
  refresh: MachineCapabilitiesRefreshPort;
}

export interface StartBackgroundCapabilitiesDiscoveryDeps {
  discovery: BackgroundCapabilitiesDiscoveryPort;
}

export async function refreshMachineCapabilities(
  deps: RefreshMachineCapabilitiesDeps
): Promise<RefreshMachineCapabilitiesOutcome> {
  return deps.refresh.refresh();
}

export function startBackgroundMachineCapabilitiesDiscovery(
  deps: StartBackgroundCapabilitiesDiscoveryDeps
): void {
  deps.discovery.start();
}
