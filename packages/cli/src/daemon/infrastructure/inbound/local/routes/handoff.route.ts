import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';

import { enqueueEnhancerJob } from '../../../../application/use-cases/enhancer/enqueue-enhancer-job.js';
import type { OutboundEvent } from '../../../../domain/entities/outbound-event.js';
import {
  executeHandoff,
  type OrchestrationTaskReadyEvent,
  type HandoffChatroomPort,
} from '../../../../domain/usecase/execute-handoff.js';
import {
  fetchHandoffChatroomContext,
  getAgentHarnessForRole,
  type HandoffChatroomAdapterDeps,
} from '../../../convex/adapters/handoff-chatroom-adapter.js';
import { getEnhancerQueuePort } from '../../../persistence/enhancer-queue.js';

export type HandoffRouteDeps = {
  machineId: string;
  sessionId: string;
  db: DatabaseSync;
  appendEvent: (event: OutboundEvent) => void;
  query: HandoffChatroomAdapterDeps['query'];
  emitOrchestrationEvent?: (event: OrchestrationTaskReadyEvent) => void;
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw.length === 0 ? {} : JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

// fallow-ignore-next-line complexity
export async function handleHandoffRoute(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HandoffRouteDeps
): Promise<void> {
  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, {
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' },
    });
    return;
  }

  const { chatroomId, senderRole, content, targetRole } = body as Record<string, unknown>;
  if (
    typeof chatroomId !== 'string' ||
    typeof senderRole !== 'string' ||
    typeof content !== 'string' ||
    typeof targetRole !== 'string'
  ) {
    sendJson(res, 400, {
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'Missing or invalid fields: chatroomId, senderRole, content, targetRole',
      },
    });
    return;
  }

  const adapterDeps: HandoffChatroomAdapterDeps = {
    query: deps.query,
    sessionId: deps.sessionId,
  };
  const chatroom: HandoffChatroomPort = {
    getContext: (chatroomIdArg) => fetchHandoffChatroomContext(adapterDeps, chatroomIdArg),
    getAgentHarness: (chatroomIdArg, role) =>
      getAgentHarnessForRole(adapterDeps, chatroomIdArg, role),
  };

  const result = await executeHandoff(
    {
      db: deps.db,
      machineId: deps.machineId,
      chatroom,
      appendEvent: deps.appendEvent,
      enqueueEnhancerJob: (input) => enqueueEnhancerJob({ queue: getEnhancerQueuePort() }, input),
      emitOrchestrationEvent: deps.emitOrchestrationEvent,
    },
    {
      sessionId: deps.sessionId,
      chatroomId,
      senderRole,
      content,
      targetRole,
    }
  );

  if (!result.success) {
    sendJson(res, 400, result);
    return;
  }
  sendJson(res, 200, result);
}
