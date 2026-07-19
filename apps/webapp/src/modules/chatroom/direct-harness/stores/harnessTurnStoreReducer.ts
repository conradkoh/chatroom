import type { HarnessTurnView } from '@workspace/backend/src/domain/direct-harness/types';

export interface HarnessTurnStoreState {
  turns: HarnessTurnView[];
  oldestTurnSeq: number | null;
  tailAfterTurnSeq: number | null;
  isInitialized: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
  olderQuerySeq: number | null;
}

export const harnessTurnStoreInitialState: HarnessTurnStoreState = {
  turns: [],
  oldestTurnSeq: null,
  tailAfterTurnSeq: null,
  isInitialized: false,
  hasMoreOlder: false,
  isLoadingOlder: false,
  olderQuerySeq: null,
};

export type HarnessTurnStoreAction =
  | { type: 'INITIALIZE'; turns: HarnessTurnView[]; hasMore: boolean }
  | { type: 'APPEND_OR_UPDATE_TAIL'; turns: HarnessTurnView[] }
  | { type: 'PREPEND_OLDER'; turns: HarnessTurnView[]; hasMore: boolean }
  | { type: 'REQUEST_OLDER' }
  | { type: 'RESET' };

function mergeByIdAndAppend(
  existing: HarnessTurnView[],
  incoming: HarnessTurnView[]
): HarnessTurnView[] {
  if (incoming.length === 0) return existing;
  const idxById = new Map(existing.map((t, i) => [t._id, i]));
  const result = [...existing];
  for (const turn of incoming) {
    const idx = idxById.get(turn._id);
    if (idx !== undefined) {
      result[idx] = turn;
    } else {
      result.push(turn);
    }
  }
  result.sort((a, b) => a.turnSeq - b.turnSeq);
  return result;
}

// fallow-ignore-next-line complexity
function applyInitialize(
  state: HarnessTurnStoreState,
  action: Extract<HarnessTurnStoreAction, { type: 'INITIALIZE' }>
): HarnessTurnStoreState {
  if (state.isInitialized) return state;
  const oldestTurnSeq = action.turns[0]?.turnSeq ?? null;
  return {
    ...state,
    turns: action.turns,
    oldestTurnSeq,
    tailAfterTurnSeq: oldestTurnSeq !== null ? oldestTurnSeq - 1 : 0,
    isInitialized: true,
    hasMoreOlder: action.hasMore,
  };
}

function applyAppendOrUpdateTail(
  state: HarnessTurnStoreState,
  action: Extract<HarnessTurnStoreAction, { type: 'APPEND_OR_UPDATE_TAIL' }>
): HarnessTurnStoreState {
  if (!state.isInitialized) return state;
  const merged = mergeByIdAndAppend(state.turns, action.turns);
  if (merged === state.turns) return state;
  return { ...state, turns: merged };
}

function applyPrependOlder(
  state: HarnessTurnStoreState,
  action: Extract<HarnessTurnStoreAction, { type: 'PREPEND_OLDER' }>
): HarnessTurnStoreState {
  const { turns, hasMore } = action;
  const existingIds = new Set(state.turns.map((t) => t._id));
  const newOnes = turns.filter((t) => !existingIds.has(t._id));
  if (newOnes.length === 0) {
    return { ...state, hasMoreOlder: hasMore, isLoadingOlder: false, olderQuerySeq: null };
  }
  const merged = [...newOnes, ...state.turns].sort((a, b) => a.turnSeq - b.turnSeq);
  return {
    ...state,
    turns: merged,
    oldestTurnSeq: merged[0]?.turnSeq ?? null,
    hasMoreOlder: hasMore,
    isLoadingOlder: false,
    olderQuerySeq: null,
  };
}

function applyRequestOlder(state: HarnessTurnStoreState): HarnessTurnStoreState {
  if (state.isLoadingOlder || !state.hasMoreOlder || state.oldestTurnSeq === null) return state;
  return { ...state, isLoadingOlder: true, olderQuerySeq: state.oldestTurnSeq };
}

// fallow-ignore-next-line complexity
export function harnessTurnStoreReducer(
  state: HarnessTurnStoreState,
  action: HarnessTurnStoreAction
): HarnessTurnStoreState {
  switch (action.type) {
    case 'INITIALIZE':
      return applyInitialize(state, action);
    case 'APPEND_OR_UPDATE_TAIL':
      return applyAppendOrUpdateTail(state, action);
    case 'PREPEND_OLDER':
      return applyPrependOlder(state, action);
    case 'REQUEST_OLDER':
      return applyRequestOlder(state);
    case 'RESET':
      return harnessTurnStoreInitialState;
    default:
      return state;
  }
}
