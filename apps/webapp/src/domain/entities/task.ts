/**
 * Domain Entity: Task
 *
 * Canonical task-related types for the frontend.
 * These mirror the backend definitions in services/backend/convex/lib/taskStateMachine.ts
 * but are declared here to avoid cross-package imports.
 */

export type TaskStatus = 'pending' | 'acknowledged' | 'in_progress' | 'completed';

export type TaskOrigin = 'backlog' | 'chat';
