import type { HarnessSessionMonitor, SessionExitClassification } from '../../../../domain/entities/session-monitor.js';

const NO_FAILURE: SessionExitClassification = {
  hadSessionFailure: false,
  failureKind: 'none',
  recoverable: true,
};

export const noOpSessionMonitor: HarnessSessionMonitor = {
  classifyExitFailure: () => NO_FAILURE,
};
