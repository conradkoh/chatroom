/**
 * Shared types for prompt generation
 */

export interface RolePromptContext {
  chatroomId: string;
  role: string;
  teamRoles: string[];
  isEntryPoint: boolean;
  availableHandoffRoles: string[];
  cliEnvPrefix?: string;
}

export interface InitPromptInput {
  chatroomId: string;
  role: string;
  teamId?: string;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string;
}

export interface RoleTemplate {
  name: string;
  responsibilities: string[];
  capabilities: string[];
  description: string;
}
