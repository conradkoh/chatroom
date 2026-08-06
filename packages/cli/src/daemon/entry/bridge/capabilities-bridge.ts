import type { Layer } from 'effect';
import { Effect } from 'effect';

import type {
  DaemonMutableStateService,
  DaemonSessionService,
} from '../../../commands/machine/daemon-start/daemon-services.js';
import {
  refreshModelsEffect,
  startBackgroundModelDiscoveryEffect,
  type RefreshModelsOutcome,
} from '../../../commands/machine/daemon-start/models-refresh.js';
import type {
  RefreshMachineCapabilitiesOutcome,
  RefreshMachineCapabilitiesDeps,
  StartBackgroundCapabilitiesDiscoveryDeps,
} from '../../domain/usecase/refresh-machine-capabilities.js';

type CapabilitiesEffectLayer = Layer.Layer<
  DaemonSessionService | DaemonMutableStateService,
  never,
  never
>;

function mapOutcome(outcome: RefreshModelsOutcome): RefreshMachineCapabilitiesOutcome {
  switch (outcome.kind) {
    case 'pushed':
      return { kind: 'pushed' };
    case 'skipped_no_changes':
      return { kind: 'skipped_no_changes' };
    case 'failed':
      return { kind: 'failed', message: outcome.message };
    case 'noop':
      return { kind: 'noop' };
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

export function createRefreshMachineCapabilitiesDeps(
  layer: CapabilitiesEffectLayer
): RefreshMachineCapabilitiesDeps {
  return {
    refresh: {
      refresh: async () =>
        mapOutcome(await Effect.runPromise(refreshModelsEffect.pipe(Effect.provide(layer)))),
    },
  };
}

export function createStartBackgroundCapabilitiesDiscoveryDeps(
  layer: CapabilitiesEffectLayer
): StartBackgroundCapabilitiesDiscoveryDeps {
  return {
    discovery: {
      start: () => {
        Effect.runFork(startBackgroundModelDiscoveryEffect.pipe(Effect.provide(layer)));
      },
    },
  };
}
