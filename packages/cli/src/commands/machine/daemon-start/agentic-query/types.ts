export type AgenticPendingSessionInfo = {
  kind: 'agentic-query';
  harnessSessionId: string;
  workspaceId: string;
  harnessName: string;
  opencodeSessionId: string | undefined;
  agenticQueryId: string;
  chatroomId: string;
  lastUsedConfig: {
    agent: string;
    model?: { providerID: string; modelID: string };
  };
};

export type AgenticPendingMessage = {
  harnessSessionId: string;
  content: string;
  seq: number;
};

export type AgenticPendingBatch = {
  sessions: AgenticPendingSessionInfo[];
  messages: AgenticPendingMessage[];
};
