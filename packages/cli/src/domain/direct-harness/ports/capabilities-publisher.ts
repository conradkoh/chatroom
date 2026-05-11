/**
 * Port for publishing machine capabilities to the backend.
 *
 * The Convex transport implements this by calling the
 * chatroom/directHarness/capabilities.publishMachineCapabilities mutation.
 */

import type { MachineCapabilities } from '../entities/machine-capabilities.js';

/** Port for publishing machine capabilities. */
export interface CapabilitiesPublisher {
  /**
   * Publish (or update) the capability snapshot for a machine.
   * Upsert semantics — replaces any previous snapshot for the machineId.
   */
  publish(caps: MachineCapabilities): Promise<void>;
}
