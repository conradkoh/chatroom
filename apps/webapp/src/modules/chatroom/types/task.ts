/**
 * Task Status Types
 *
 * Shared frontend type definitions for chatroom task statuses.
 *
 * Canonical source of truth:
 *   - Backend type: services/backend/convex/lib/taskStateMachine.ts → TaskStatus
 *   - Schema:       services/backend/convex/schema.ts → chatroom_tasks.status
 *
 * These are maintained separately because the backend (Convex) types can't be
 * directly imported by the Next.js frontend at the type level in all contexts.
 *
 * Keep in sync with the backend when adding or removing statuses.
 */

/**
 * All possible statuses for a chatroom task.
 *
 * Workflow depends on origin:
 *   - Chat origin:    queued → pending → acknowledged → in_progress → completed
 *   - Backlog origin: backlog → backlog_acknowledged → in_progress → pending_user_review → completed/closed
 */
export type TaskStatus =
  | 'backlog' // Backlog origin: initial state, task is in backlog tab
  | 'queued' // Waiting in line (hidden from agent)
  | 'pending' // Ready for agent to pick up
  | 'acknowledged' // Agent claimed task via wait-for-task, not yet started
  | 'in_progress' // Agent actively working on it
  | 'backlog_acknowledged' // Backlog task attached to message, visible to agent
  | 'pending_user_review' // Backlog only: agent done, user must confirm
  | 'completed' // Finished successfully
  | 'closed'; // Backlog only: user closed without completing

/**
 * Origin of a chatroom task.
 */
export type TaskOrigin = 'backlog' | 'chat';
