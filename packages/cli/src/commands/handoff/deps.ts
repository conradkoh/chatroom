/** Handoff Deps — dependency interfaces for the handoff command. */

import type { BackendOps, SessionOps } from '../../infrastructure/deps/index.js';

export type HandoffResult = {
  success: boolean;
  error?:
    | {
        message: string;
        code?: string | undefined;
        suggestedTarget?: string | undefined;
        suggestedTargets?: string[] | undefined;
      }
    | undefined;
  supportsNativeIntegration?: boolean | undefined;
  enhancerJobId?: string | null | undefined;
  enhancerRequestQueued?: boolean | undefined;
  newTaskId?: string | null | undefined;
};

export interface HandoffGatewayOps {
  handoff(args: {
    sessionId: string;
    chatroomId: string;
    senderRole: string;
    content: string;
    targetRole: string;
  }): Promise<HandoffResult>;
}

export interface HandoffDeps {
  gateway: HandoffGatewayOps;
  session: SessionOps;
  /** Test-only backend compatibility; production defaults never use this. */
  backend: BackendOps;
}
