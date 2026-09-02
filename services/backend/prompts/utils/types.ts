/**
 * Shared types for prompt generation
 */

export interface RolePromptContext {
  chatroomId: string;
  role: string;
  teamRoles: string[];
  isEntryPoint: boolean;
  availableHandoffRoles: string[];
  cliEnvPrefix?: string | undefined;
}

export interface InitPromptInput {
  chatroomId: string;
  role: string;
  teamId?: string | undefined;
  teamName: string;
  teamRoles: string[];
  teamEntryPoint?: string | undefined;
}

export interface RoleTemplate {
  name: string;
  responsibilities: string[];
  capabilities: string[];
  description: string;
}
