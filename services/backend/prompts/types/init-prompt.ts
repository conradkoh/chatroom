import type { AgentHarness } from '../../src/domain/entities/agent';

export interface InitPromptInput {
  chatroomId: string;
  role: string;
  teamId?: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
  convexUrl: string;
  /** Agent type for register-agent command — 'unset' produces `<remote|custom>` placeholder */
  agentType?: 'remote' | 'custom' | 'unset';
  /** Remote agent harness — determines native vs CLI init prompt sections */
  agentHarness?: AgentHarness;
}

export interface ComposedInitPrompt {
  systemPrompt: string;
  initMessage: string;
  initPrompt: string;
}
