/** Shared types for the harness selector bar. */

export interface AgentOption {
  name: string;
  mode: 'subagent' | 'primary' | 'all';
  model?: { providerID: string; modelID: string };
  description?: string;
}

export interface ProviderOption {
  providerID: string;
  name: string;
  models: { modelID: string; name: string }[];
}
