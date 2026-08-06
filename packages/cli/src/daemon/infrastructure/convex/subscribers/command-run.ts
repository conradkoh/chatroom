import { api } from '../../../../api.js';
import type { InboundEvent } from '../../../domain/entities/inbound-event.js';
import type { ConvexSubscriberDeps } from '../subscriber-deps.js';

export type SubscriberHandle = { stop(): Promise<void> };

interface CommandRunRow {
  _id: string | { toString(): string };
}

interface ActionableCommandRuns {
  pendingRuns?: CommandRunRow[];
  stopRequestedRuns?: CommandRunRow[];
}

function runId(run: CommandRunRow): string {
  return typeof run._id === 'string' ? run._id : run._id.toString();
}

export function startCommandRunSubscriber(
  deps: ConvexSubscriberDeps,
  onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  const seen = new Set<string>();

  // fallow-ignore-next-line complexity
  const emitRuns = (runs: CommandRunRow[] | undefined): void => {
    if (!runs?.length) return;
    for (const run of runs) {
      const id = runId(run);
      if (seen.has(id)) continue;
      seen.add(id);
      onEvent({ type: 'command-run.updated', runId: id });
    }
  };

  const unsub = deps.wsClient.onUpdate(
    api.daemon.commands.listActionableCommandRuns,
    { sessionId: deps.sessionId, machineId: deps.machineId },
    (result: ActionableCommandRuns | null | undefined) => {
      if (!result) return;
      emitRuns(result.pendingRuns);
      emitRuns(result.stopRequestedRuns);
    },
    (err: unknown) => {
      console.warn(
        `[daemon] command-run subscriber error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  );

  return {
    async stop() {
      unsub();
    },
  };
}
