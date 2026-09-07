import type { TurnEndInput, TurnEndResult } from '../entities/native-turn.js';

export interface HandleTurnCompletedDeps {
  killProcess: (pid: number) => void;
}

export async function handleTurnCompleted(
  deps: HandleTurnCompletedDeps,
  input: TurnEndInput
): Promise<TurnEndResult> {
  deps.killProcess(input.pid);
  return { outcome: 'killed' };
}
