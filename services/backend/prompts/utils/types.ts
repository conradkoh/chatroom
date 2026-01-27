/**
 * Shared types for prompt generation
 */

export interface RolePromptContext {
  chatroomId: string;
  role: string;
  teamRoles: string[];
  isEntryPoint: boolean;
  currentClassification?: string;
  userContext?: {
    originalRequest: string;
    featureTitle?: string;
    featureDescription?: string;
    techSpecs?: string;
  };
  canHandoffToUser: boolean;
  restrictionReason?: string;
  availableHandoffRoles: string[];
  cliEnvPrefix?: string;
}

export interface InitPromptInput {
  chatroomId: string;
  role: string;
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
