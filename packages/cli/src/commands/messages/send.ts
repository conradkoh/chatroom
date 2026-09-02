import { api, type Id } from '../../api.js';
import { getSessionId } from '../../infrastructure/auth/storage.js';
import { getConvexClient } from '../../infrastructure/convex/client.js';
import type { BackendOps } from '../../infrastructure/deps/index.js';

export interface SendMessageDeps {
  backend: Pick<BackendOps, 'mutation' | 'query'>;
  session: { getSessionId: () => Promise<string | null> };
}

interface ChatroomEntryPoint {
  teamEntryPoint?: string | undefined;
}

async function createDefaultDeps(): Promise<SendMessageDeps> {
  const client = await getConvexClient();
  return {
    backend: {
      mutation: (endpoint, args) => client.mutation(endpoint, args),
      query: (endpoint, args) => client.query(endpoint, args),
    },
    session: { getSessionId },
  };
}

async function requireSession(deps: SendMessageDeps): Promise<string> {
  const sessionId = await deps.session.getSessionId();
  if (!sessionId) throw new Error('Not authenticated. Please run: chatroom auth login');
  return sessionId;
}

// fallow-ignore-next-line complexity
export async function sendUserMessage(
  chatroomId: string,
  options: { content: string; targetRole?: string | undefined },
  deps?: SendMessageDeps
): Promise<void> {
  if (!options.content.trim()) throw new Error('Message content cannot be empty');
  const d = deps ?? (await createDefaultDeps());
  const sessionId = await requireSession(d);
  const chatroom = (await d.backend.query(api.chatrooms.get, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  })) as ChatroomEntryPoint | null;
  if (!chatroom) throw new Error(`Chatroom not found or access denied: ${chatroomId}`);
  const targetRole = options.targetRole ?? chatroom.teamEntryPoint;
  if (!targetRole) throw new Error('Chatroom has no team entry point');
  const messageId = await d.backend.mutation(api.messages.sendMessage, {
    sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    senderRole: 'user',
    content: options.content,
    targetRole,
    type: 'message',
  });
  console.log(`✅ Message sent to ${targetRole}`);
  console.log(`  Message ID: ${messageId}`);
  console.log('  Check task status with: chatroom messages list');
}
