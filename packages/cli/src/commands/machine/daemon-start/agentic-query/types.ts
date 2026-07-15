export type AgenticLastUsedConfig = {
  agent: string;
  model?: { providerID: string; modelID: string };
};

export type AgenticPendingOpenSession = {
  kind: 'agentic-query';
  _id: string;
  workspaceId: string;
  harnessName: string;
  agenticQueryId: string;
  chatroomId: string;
  lastUsedConfig: AgenticLastUsedConfig;
};

export type AgenticPendingPromptSession = {
  kind: 'agentic-query';
  _id: string;
  workspaceId: string;
  harnessName: string;
  opencodeSessionId: string | undefined;
  agenticQueryId: string;
  chatroomId: string;
  lastUsedConfig: AgenticLastUsedConfig;
};

export type AgenticPendingMessage = {
  harnessSessionId: string;
  content: string;
  seq: number;
};

export type AgenticPendingBatch = {
  sessions: AgenticPendingPromptSession[];
  messages: AgenticPendingMessage[];
};
