/**
 * Convex API access following proper conventions
 * See: https://docs.convex.dev/client/react
 *
 * We use typed function references to maintain type safety
 */
import type { FunctionReference } from 'convex/server';

// Type for Convex IDs - matches the Convex GenericId type
export type Id<TableName extends string> = string & { __tableName: TableName };

// Type helpers for Convex responses
export interface Chatroom {
  _id: Id<'chatroom_rooms'>;
  status: 'active' | 'interrupted' | 'completed';
  ownerId: Id<'users'>;
  teamId?: string;
  teamName?: string;
  teamRoles?: string[];
  teamEntryPoint?: string;
  _creationTime?: number;
}

export interface Message {
  _id: Id<'chatroom_messages'>;
  chatroomId: Id<'chatroom_rooms'>;
  senderRole: string;
  content: string;
  type: 'message' | 'handoff' | 'interrupt' | 'join';
  targetRole?: string;
  claimedByRole?: string;
  classification?: 'question' | 'new_feature' | 'follow_up';
  taskOriginMessageId?: Id<'chatroom_messages'>;
  _creationTime?: number;
}

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

export interface Participant {
  _id: Id<'chatroom_participants'>;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  status: 'active' | 'waiting' | 'idle';
  _creationTime?: number;
}

export interface TeamReadinessInfo {
  isReady: boolean;
  teamName: string;
  expectedRoles: string[];
  presentRoles: string[];
  missingRoles: string[];
}

// Create typed function references for the chatroom-related APIs
// This follows Convex conventions while avoiding backend dependency issues
export const api = {
  chatrooms: {
    get: 'chatrooms:get' as unknown as FunctionReference<'query', 'public'>,
    create: 'chatrooms:create' as unknown as FunctionReference<'mutation', 'public'>,
    updateStatus: 'chatrooms:updateStatus' as unknown as FunctionReference<'mutation', 'public'>,
    interrupt: 'chatrooms:interrupt' as unknown as FunctionReference<'mutation', 'public'>,
    getTeamReadiness: 'chatrooms:getTeamReadiness' as unknown as FunctionReference<
      'query',
      'public'
    >,
  },
  messages: {
    send: 'messages:send' as unknown as FunctionReference<'mutation', 'public'>,
    list: 'messages:list' as unknown as FunctionReference<'query', 'public'>,
    getLatestForRole: 'messages:getLatestForRole' as unknown as FunctionReference<
      'query',
      'public'
    >,
    claimMessage: 'messages:claimMessage' as unknown as FunctionReference<'mutation', 'public'>,
    taskStarted: 'messages:taskStarted' as unknown as FunctionReference<'mutation', 'public'>,
    getAllowedHandoffRoles: 'messages:getAllowedHandoffRoles' as unknown as FunctionReference<
      'query',
      'public'
    >,
    getContextWindow: 'messages:getContextWindow' as unknown as FunctionReference<
      'query',
      'public'
    >,
    getRolePrompt: 'messages:getRolePrompt' as unknown as FunctionReference<'query', 'public'>,
  },
  participants: {
    join: 'participants:join' as unknown as FunctionReference<'mutation', 'public'>,
    updateStatus: 'participants:updateStatus' as unknown as FunctionReference<'mutation', 'public'>,
    list: 'participants:list' as unknown as FunctionReference<'query', 'public'>,
  },
  cliAuth: {
    createAuthRequest: 'cliAuth:createAuthRequest' as unknown as FunctionReference<
      'mutation',
      'public'
    >,
    getAuthRequestStatus: 'cliAuth:getAuthRequestStatus' as unknown as FunctionReference<
      'query',
      'public'
    >,
    validateSession: 'cliAuth:validateSession' as unknown as FunctionReference<'query', 'public'>,
    touchSession: 'cliAuth:touchSession' as unknown as FunctionReference<'mutation', 'public'>,
  },
  tasks: {
    createTask: 'tasks:createTask' as unknown as FunctionReference<'mutation', 'public'>,
    startTask: 'tasks:startTask' as unknown as FunctionReference<'mutation', 'public'>,
    completeTask: 'tasks:completeTask' as unknown as FunctionReference<'mutation', 'public'>,
    completeTaskById: 'tasks:completeTaskById' as unknown as FunctionReference<
      'mutation',
      'public'
    >,
    cancelTask: 'tasks:cancelTask' as unknown as FunctionReference<'mutation', 'public'>,
    updateTask: 'tasks:updateTask' as unknown as FunctionReference<'mutation', 'public'>,
    moveToQueue: 'tasks:moveToQueue' as unknown as FunctionReference<'mutation', 'public'>,
    listTasks: 'tasks:listTasks' as unknown as FunctionReference<'query', 'public'>,
    getActiveTask: 'tasks:getActiveTask' as unknown as FunctionReference<'query', 'public'>,
    getTaskCounts: 'tasks:getTaskCounts' as unknown as FunctionReference<'query', 'public'>,
  },
};

// Response types for CLI Auth
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
