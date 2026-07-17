import type {
  HarnessTurnView,
  HarnessMessage,
} from '@workspace/backend/src/domain/direct-harness/types';

/** Typed config for the parameterized core hook. Query refs are Convex FunctionReference. */
export interface HarnessTurnStoreQueries {
  readonly getLatestTurns: any;
  readonly getTurnsSince: any;
  readonly getOlderTurns: any;
  readonly getStreamingTurnChunks: any;
}

export interface HarnessTurnStoreConfig<TScopeId extends string> {
  readonly scopeId: TScopeId;
  readonly scopeArgKey: string;
  readonly queries: HarnessTurnStoreQueries;
  readonly logLabel: string;
}

export interface StreamingOverlay {
  turnId: string;
  textContent: string;
  reasoningContent: string;
}

/** Minimal streaming-turn shape needed by overlay logic. */
export type StreamingTurnCandidate = Pick<HarnessTurnView, '_id' | 'messageId' | 'role' | 'status'>;

/** Wire types matching backend return shapes. */
export type HarnessLatestTurnsPage = {
  turns: HarnessTurnView[];
  hasMore: boolean;
  newestTurnSeq: number | null;
};

export type HarnessOlderTurnsPage = {
  turns: HarnessTurnView[];
  hasMore: boolean;
};

export type HarnessTurnsSincePage = HarnessTurnView[];

export type HarnessStreamingChunk = HarnessMessage;
