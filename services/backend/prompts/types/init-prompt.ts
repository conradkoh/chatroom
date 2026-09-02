import type { AgentHarness } from '../../src/domain/entities/agent';

export interface ActivatedSkillSnapshot {
  skillId: string;
  name: string;
  description: string;
  prompt: string;
}

export interface InitPromptInput {
  chatroomId: string;
  role: string;
  teamId?: string | undefined;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string | undefined;
  convexUrl: string;
  /** Agent type for register-agent command — 'unset' produces `<remote|custom>` placeholder */
  agentType?: 'remote' | 'custom' | 'unset' | undefined;
  /** Remote agent harness — determines native vs CLI init prompt sections */
  agentHarness?: AgentHarness | undefined;
  activatedSkills?: ActivatedSkillSnapshot[] | undefined;
}

export interface ComposedInitPrompt {
  systemPrompt: string;
  initMessage: string;
  initPrompt: string;
}
