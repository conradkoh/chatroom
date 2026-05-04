/**
 * Domain use case: collect and publish machine capabilities.
 *
 * Orchestrates:
 *   1. Collect agent + provider lists from each harness on the machine
 *   2. Assemble a MachineCapabilities payload
 *   3. Publish via CapabilitiesPublisher
 */

import type {
  HarnessCapabilities,
  MachineCapabilities,
  PublishedAgent,
  PublishedProvider,
  WorkspaceCapabilities,
} from '../entities/machine-capabilities.js';
import type { CapabilitiesPublisher } from '../ports/capabilities-publisher.js';

// ─── Ports ────────────────────────────────────────────────────────────────────

/** Collects available agents and providers from a running harness. */
export interface CapabilitiesCollector {
  listAgents(): Promise<readonly PublishedAgent[]>;
  listProviders(): Promise<readonly PublishedProvider[]>;
  /** Harness display metadata. */
  readonly name: string;
  readonly displayName: string;
  readonly configSchema?: unknown;
}

/** Resolves collectors for all active workspaces on this machine. */
export interface CollectorResolver {
  getCollectors(): Promise<readonly { workspace: WorkspaceCapabilities; collector: CapabilitiesCollector }[]>;
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface PublishCapabilitiesDeps {
  readonly collectorResolver: CollectorResolver;
  readonly publisher: CapabilitiesPublisher;
  readonly machineId: string;
  readonly nowFn?: () => number;
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface PublishCapabilitiesInput {
  /** The base workspace list before populating harness details. */
  readonly workspaces: readonly WorkspaceCapabilities[];
}

// ─── Use case function ────────────────────────────────────────────────────────

export async function publishCapabilities(
  deps: PublishCapabilitiesDeps,
  _input: PublishCapabilitiesInput
): Promise<void> {
  throw new Error('Not implemented');
}
