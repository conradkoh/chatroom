/**
 * Domain Entity: BacklogItem
 *
 * Canonical backlog-related types for the frontend.
 * These mirror the backend definitions in services/backend/convex/lib/backlogStateMachine.ts
 * but are declared here to avoid cross-package imports.
 */

export type BacklogItemStatus = 'backlog' | 'pending_user_review' | 'closed';
