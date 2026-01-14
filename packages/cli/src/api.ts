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
  _id: Id<'chatrooms'>;
  status: 'active' | 'interrupted' | 'completed';
  teamId?: string;
  teamName?: string;
  teamRoles?: string[];
  teamEntryPoint?: string;
  _creationTime?: number;
}

export interface Message {
  _id: Id<'messages'>;
  chatroomId: Id<'chatrooms'>;
  senderRole: string;
  content: string;
  type: 'message' | 'handoff' | 'interrupt' | 'join';
  targetRole?: string;
  claimedByRole?: string;
  _creationTime?: number;
}

export interface Participant {
  _id: Id<'participants'>;
  chatroomId: Id<'chatrooms'>;
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
  },
  participants: {
    join: 'participants:join' as unknown as FunctionReference<'mutation', 'public'>,
    updateStatus: 'participants:updateStatus' as unknown as FunctionReference<'mutation', 'public'>,
    list: 'participants:list' as unknown as FunctionReference<'query', 'public'>,
  },
};
