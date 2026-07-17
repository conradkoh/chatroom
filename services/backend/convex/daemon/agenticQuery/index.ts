import { appendMessages, pendingForMachine as messagesPendingForMachine } from './messages';
import { dequeueNext, setGenerating } from './queue';
import {
  associateOpenCodeSessionId,
  closeRun,
  getRun,
  markActive,
  markFailed,
  markIdle,
  pendingForMachine as runsPendingForMachine,
} from './runs';
import {
  beginAssistantTurn,
  bindTurnMessageId,
  finalizeAssistantTurn,
  markOrphanTurnsFailed,
  markTurnProcessed,
} from './turns';

export const runs = {
  associateOpenCodeSessionId,
  closeRun,
  markIdle,
  markFailed,
  markActive,
  getRun,
  pendingForMachine: runsPendingForMachine,
};

export const sessions = {
  pendingForMachine: runsPendingForMachine,
};

export const messages = {
  appendMessages,
  pendingForMachine: messagesPendingForMachine,
};

export const turns = {
  beginAssistantTurn,
  bindTurnMessageId,
  finalizeAssistantTurn,
  markOrphanTurnsFailed,
  markTurnProcessed,
};

export const queue = {
  setGenerating,
  dequeueNext,
};
