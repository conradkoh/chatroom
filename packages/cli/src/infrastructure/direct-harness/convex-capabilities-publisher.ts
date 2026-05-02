/**
 * Convex-backed CapabilitiesPublisher transport.
 *
 * Calls the chatroom/directHarness/capabilities.publishMachineCapabilities
 * mutation to upsert the machine capability snapshot.
 */

import type { CapabilitiesPublisher, MachineCapabilities } from '../../domain/direct-harness/index.js';
import { api } from '../../api.js';

/** Minimal backend interface required by the publisher. */
export interface CapabilitiesTransportBackend {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutation: (endpoint: any, args: any) => Promise<any>;
}

/** Construction options for ConvexCapabilitiesPublisher. */
export interface ConvexCapabilitiesPublisherOptions {
  /** Authenticated backend client. */
  readonly backend: CapabilitiesTransportBackend;
  /** CLI auth session id. */
  readonly sessionId: string;
}

/**
 * Publishes machine capabilities to the Convex backend.
 *
 * Publish failures are logged as warnings but do not propagate —
 * the UI renders stale data gracefully until the next successful publish.
 */
export class ConvexCapabilitiesPublisher implements CapabilitiesPublisher {
  constructor(private readonly options: ConvexCapabilitiesPublisherOptions) {}

  async publish(caps: MachineCapabilities): Promise<void> {
    const { backend, sessionId } = this.options;

    await backend.mutation(api.chatroom.directHarness.capabilities.publishMachineCapabilities, {
      sessionId,
      machineId: caps.machineId,
      workspaces: caps.workspaces.map((ws) => ({
        workspaceId: ws.workspaceId,
        cwd: ws.cwd,
        name: ws.name,
        agents: ws.agents.map((a) => ({
          name: a.name,
          mode: a.mode,
          ...(a.model ? { model: a.model } : {}),
          ...(a.description ? { description: a.description } : {}),
        })),
      })),
    });
  }
}
