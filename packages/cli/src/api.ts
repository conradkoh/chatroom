/**
 * Convex API re-exports for CLI
 *
 * This file re-exports from the backend's generated API.
 * Uses workspace imports during development, which get bundled during build.
 *
 * @module
 */

// Re-export the generated API and types from backend
// Import Doc type for use below
import type { Doc } from '@workspace/backend/convex/_generated/dataModel';

export { api } from '@workspace/backend/convex/_generated/api';
export type { Id, Doc } from '@workspace/backend/convex/_generated/dataModel';

// Re-export types for convenience (these match the actual backend schema)
export type Chatroom = Doc<'chatroom_rooms'>;
export type Message = Doc<'chatroom_messages'>;
export type Task = Doc<'chatroom_tasks'>;
export type Artifact = Doc<'chatroom_artifacts'>;
export type Participant = Doc<'chatroom_participants'>;

// TaskWithMessage is a common pattern in CLI commands
export interface TaskWithMessage {
  task: Task;
  message: Message | null;
}

// CLI Auth response types (these are defined in backend functions)
export interface AuthRequestResult {
  requestId: string;
  expiresAt: number;
}

export interface AuthRequestStatus {
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'not_found';
  sessionId?: string;
  expiresAt?: number;
}

export interface SessionValidation {
  valid: boolean;
  userId?: string;
  userName?: string;
  reason?: string;
}

// Response types from backend functions
export interface AllowedHandoffRoles {
  availableRoles: string[];
  canHandoffToUser: boolean;
  restrictionReason: string | null;
  currentClassification: 'question' | 'new_feature' | 'follow_up' | null;
}

export interface ContextWindow {
  originMessage: Message | null;
  contextMessages: Message[];
  classification: 'question' | 'new_feature' | 'follow_up' | null;
}

export interface RolePromptResponse {
  prompt: string;
  currentClassification: 'question' | 'new_feature' | 'follow_up' | null;
  availableHandoffRoles: string[];
  canHandoffToUser: boolean;
  restrictionReason: string | null;
}

export interface TeamReadinessInfo {
  isReady: boolean;
  teamName: string;
  expectedRoles: string[];
  presentRoles: string[];
  missingRoles: string[];
}
