/**
 * RegisterAgentMachineService — Effect Context.Tag for machine operations
 *
 * This service wraps local machine configuration operations (not Convex-related).
 */

import { Context, type Effect } from 'effect';

import type { MachineConfig } from '../../infrastructure/machine/types.js';

export interface RegisterAgentMachineServiceShape {
  getMachineId: () => Effect.Effect<string | null>;
  loadMachineConfig: () => Effect.Effect<MachineConfig | null>;
}

export class RegisterAgentMachineService extends Context.Tag('RegisterAgentMachineService')<
  RegisterAgentMachineService,
  RegisterAgentMachineServiceShape
>() {}
