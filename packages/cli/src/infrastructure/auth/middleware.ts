/**
 * Authentication middleware
 * Verifies CLI is authenticated before running commands
 */

import { getSessionId, isAuthenticated, getAuthFilePath } from './storage.js';
import { api, type SessionValidation } from '../../api.js';
import { getConvexClient } from '../convex/client.js';

export interface AuthContext {
  sessionId: string;
  userId: string;
  userName?: string;
}

/**
 * Require authentication before running a command
 * Exits with error if not authenticated
 */
export async function requireAuth(): Promise<AuthContext> {
  // Check local auth file first
  if (!isAuthenticated()) {
    console.error(`\n❌ Error: Not authenticated`);
    console.error(`\n   Please authenticate first by running:`);
    console.error(`   $ chatroom auth login\n`);
    process.exit(1);
  }

  const sessionId = getSessionId();
  if (!sessionId) {
    console.error(`\n❌ Error: Invalid auth file`);
    console.error(`   Path: ${getAuthFilePath()}`);
    console.error(`\n   Please re-authenticate:`);
    console.error(`   $ chatroom auth login\n`);
    process.exit(1);
  }

  // Validate session with backend
  try {
    const client = await getConvexClient();
    const validation = (await client.query(api.cliAuth.validateSession, {
      sessionId,
    })) as SessionValidation;

    if (!validation.valid) {
      console.error(`\n❌ Error: Session invalid - ${validation.reason}`);
      console.error(`\n   Please re-authenticate:`);
      console.error(`   $ chatroom auth login\n`);
      process.exit(1);
    }

    // Touch the session to keep it fresh
    await client.mutation(api.cliAuth.touchSession, { sessionId });

    return {
      sessionId,
      userId: validation.userId!,
      userName: validation.userName,
    };
  } catch (error) {
    const err = error as Error;
    console.error(`\n❌ Error: Could not validate session`);
    console.error(`   ${err.message}`);
    console.error(`\n   Please check your connection and try again.`);
    process.exit(1);
  }
}

/**
 * Check if authenticated without exiting
 * Returns auth context if authenticated, null otherwise
 */
export async function checkAuth(): Promise<AuthContext | null> {
  if (!isAuthenticated()) {
    return null;
  }

  const sessionId = getSessionId();
  if (!sessionId) {
    return null;
  }

  try {
    const client = await getConvexClient();
    const validation = (await client.query(api.cliAuth.validateSession, {
      sessionId,
    })) as SessionValidation;

    if (!validation.valid) {
      return null;
    }

    return {
      sessionId,
      userId: validation.userId!,
      userName: validation.userName,
    };
  } catch {
    return null;
  }
}
