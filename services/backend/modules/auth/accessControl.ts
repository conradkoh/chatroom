import type { Doc } from '../../convex/_generated/dataModel';

export type AccessLevel = 'user' | 'system_admin';

export function getAccessLevel(user: Doc<'users'>): AccessLevel {
  return user.accessLevel ?? 'user';
}
