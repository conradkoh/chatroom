import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/** Canonical harness validator — add new harnesses here. */
export const agentHarnessValidator = v.union(
  v.literal('opencode'),
  v.literal('pi'),
  v.literal('cursor'),
  v.literal('claude')
);

/**
 * Database schema definition for the application.
 * Defines all tables, their fields, and indexes for optimal querying.
 *
 * DEPRECATION NOTICE: The fields `expiresAt` and `expiresAtLabel` in the sessions table
 * are deprecated and no longer used for session expiry. They are only kept for migration
 * compatibility and will be removed in a future migration.
 */
export default defineSchema({
  /**
   * Application metadata and version tracking.
   */
  appInfo: defineTable({
    latestVersion: v.string(),
  }),

  /**
   * Presentation state management for real-time presentation controls.
   * Tracks current slide and active presenter information.
   */
  presentationState: defineTable({
    key: v.string(), // The presentation key that identifies this presentation
    currentSlide: v.number(), // The current slide number
    lastUpdated: v.number(), // Timestamp of last update
    activePresentation: v.optional(
      v.object({
        presenterId: v.string(), // Session ID of the current presenter
      })
    ), // Optional object containing presenter information
  }).index('by_key', ['key']),

  /**
   * Discussion state management for collaborative discussions.
   * Tracks discussion lifecycle, conclusions, and metadata.
   */
  discussionState: defineTable({
    key: v.string(), // Unique identifier for the discussion
    title: v.string(), // Title of the discussion
    isActive: v.boolean(), // Whether the discussion is active or concluded
    createdAt: v.number(), // When the discussion was created
    conclusions: v.optional(
      v.array(
        v.object({
          text: v.string(), // The conclusion text
          tags: v.array(v.string()), // Optional tags for categorizing the conclusion (e.g., "task", "decision", "action", etc.)
        })
      )
    ), // Conclusions for this discussion
    concludedAt: v.optional(v.number()), // When the discussion was concluded
    concludedBy: v.optional(v.string()), // Session ID of who concluded the discussion
  }).index('by_key', ['key']),

  /**
   * Individual messages within discussions.
   * Stores message content, sender information, and timestamps.
   */
  discussionMessages: defineTable({
    discussionKey: v.string(), // The discussion this message belongs to
    name: v.string(), // Name of the person who wrote the message
    message: v.string(), // The content of the message
    timestamp: v.number(), // When the message was sent
    sessionId: v.optional(v.string()), // Session ID of the sender (optional)
  }).index('by_discussion', ['discussionKey']),

  /**
   * Checklist state management for collaborative task tracking.
   * Tracks checklist lifecycle and metadata.
   */
  checklistState: defineTable({
    key: v.string(), // Unique identifier for the checklist
    title: v.string(), // Title of the checklist
    isActive: v.boolean(), // Whether the checklist is active or concluded
    createdAt: v.number(), // When the checklist was created
    concludedAt: v.optional(v.number()), // When the checklist was concluded
    concludedBy: v.optional(v.string()), // Session ID of who concluded the checklist
  }).index('by_key', ['key']),

  /**
   * Individual items within checklists.
   * Stores item content, completion status, ordering, and audit trail.
   */
  checklistItems: defineTable({
    checklistKey: v.string(), // The checklist this item belongs to
    text: v.string(), // The item text/description
    isCompleted: v.boolean(), // Whether the item is completed
    order: v.number(), // Display order
    createdAt: v.number(), // When the item was created
    completedAt: v.optional(v.number()), // When the item was completed
    createdBy: v.optional(v.string()), // Session ID of who created the item
    completedBy: v.optional(v.string()), // Session ID of who completed the item
  })
    .index('by_checklist', ['checklistKey'])
    .index('by_checklist_order', ['checklistKey', 'order']),

  /**
   * Attendance tracking for events and meetings.
   * Records attendance status, reasons, and participant information.
   */
  attendanceRecords: defineTable({
    attendanceKey: v.string(), // The attendance session key (hardcoded)
    timestamp: v.number(), // When the attendance was recorded
    userId: v.optional(v.id('users')), // Optional user ID (for authenticated users)
    name: v.optional(v.string()), // Name (required for anonymous users)
    status: v.optional(v.union(v.literal('attending'), v.literal('not_attending'))), // Attendance status
    reason: v.optional(v.string()), // Optional reason for not attending
    remarks: v.optional(v.string()), // Optional remarks for attending
    isManuallyJoined: v.optional(v.boolean()), // Whether this person manually joined the list (vs being in expected list)
  })
    .index('by_attendance', ['attendanceKey'])
    .index('by_name_attendance', ['attendanceKey', 'name'])
    .index('by_user_attendance', ['attendanceKey', 'userId']),

  /**
   * User accounts supporting authenticated, anonymous, and Google OAuth users.
   * Stores user credentials, names, and recovery information.
   */
  users: defineTable(
    v.union(
      v.object({
        type: v.literal('full'),
        name: v.string(),
        username: v.optional(v.string()),
        email: v.string(),
        recoveryCode: v.optional(v.string()),
        accessLevel: v.optional(v.union(v.literal('user'), v.literal('system_admin'))),
        google: v.optional(
          v.object({
            id: v.string(),
            email: v.string(),
            verified_email: v.optional(v.boolean()),
            name: v.string(),
            given_name: v.optional(v.string()),
            family_name: v.optional(v.string()),
            picture: v.optional(v.string()),
            locale: v.optional(v.string()),
            hd: v.optional(v.string()),
          })
        ),
      }),
      v.object({
        type: v.literal('anonymous'),
        name: v.string(), //system generated name
        recoveryCode: v.optional(v.string()),
        accessLevel: v.optional(v.union(v.literal('user'), v.literal('system_admin'))),
      })
    )
  )
    .index('by_username', ['username'])
    .index('by_email', ['email'])
    .index('by_name', ['name'])
    .index('by_googleId', ['google.id']),

  /**
   * User sessions for authentication and state management.
   * Links session IDs to user accounts with creation timestamps.
   */
  sessions: defineTable({
    sessionId: v.string(), //this is provided by the client
    userId: v.id('users'), // null means session exists but not authenticated
    createdAt: v.number(),
    authMethod: v.optional(
      v.union(
        v.literal('google'), // Authenticated via Google OAuth
        v.literal('login_code'), // Authenticated via login code
        v.literal('recovery_code'), // Authenticated via recovery code
        v.literal('anonymous'), // Anonymous session
        v.literal('username_password') // Traditional username/password (for future use)
      )
    ), // How the user authenticated for this session
    expiresAt: v.optional(v.number()), // DEPRECATED: No longer used for session expiry. Kept for migration compatibility.
    expiresAtLabel: v.optional(v.string()), // DEPRECATED: No longer used for session expiry. Kept for migration compatibility.
    // Device and activity tracking for session management
    lastActivityAt: v.optional(v.number()), // Timestamp of last activity
    deviceInfo: v.optional(
      v.object({
        userAgent: v.optional(v.string()), // Raw user agent string
        browser: v.optional(v.string()), // Browser name (e.g., "Chrome", "Firefox")
        os: v.optional(v.string()), // Operating system (e.g., "Windows", "macOS", "iOS")
        device: v.optional(v.string()), // Device type (e.g., "Desktop", "Mobile", "Tablet")
      })
    ),
  })
    .index('by_sessionId', ['sessionId'])
    .index('by_userId', ['userId']),

  /**
   * Temporary login codes for cross-device authentication.
   * Stores time-limited codes for secure device-to-device login.
   */
  loginCodes: defineTable({
    code: v.string(), // The 8-letter login code
    userId: v.id('users'), // The user who generated this code
    createdAt: v.number(), // When the code was created
    expiresAt: v.number(), // When the code expires (1 minute after creation)
  }).index('by_code', ['code']),

  /**
   * Rate limiting for login attempts to prevent brute force attacks.
   * Tracks failed login attempts per session with automatic lockout.
   */
  loginAttempts: defineTable({
    sessionId: v.string(), // The session making the attempt
    attemptCount: v.number(), // Number of failed attempts in the window
    lastAttemptAt: v.number(), // Timestamp of the last attempt
    lockedUntil: v.optional(v.number()), // If locked out, when the lockout expires
  }).index('by_sessionId', ['sessionId']),

  /**
   * Authentication provider configuration for dynamic auth provider setup.
   * Supports multiple auth providers (Google, GitHub, etc.) with unified structure.
   */
  auth_providerConfigs: defineTable({
    type: v.union(v.literal('google')), // Auth provider type (extensible for future providers)
    enabled: v.boolean(), // Whether this auth provider is enabled
    projectId: v.optional(v.string()), // Google Cloud Project ID (optional, for convenience links)
    clientId: v.optional(v.string()), // OAuth client ID
    clientSecret: v.optional(v.string()), // OAuth client secret (encrypted storage recommended)
    redirectUris: v.array(v.string()), // Allowed redirect URIs for OAuth
    configuredBy: v.id('users'), // User who configured this (must be system_admin)
    configuredAt: v.number(), // When this configuration was created/updated
  }).index('by_type', ['type']),

  /**
   * Login requests for authentication provider flows (e.g., Google OAuth).
   * Tracks the state of a login attempt and links to sessions and users.
   */
  auth_loginRequests: defineTable({
    sessionId: v.string(), // Session initiating the login
    status: v.union(v.literal('pending'), v.literal('completed'), v.literal('failed')), // Status of the login request
    error: v.optional(v.string()), // Error message if failed
    createdAt: v.number(), // Timestamp of creation
    completedAt: v.optional(v.number()), // Timestamp of completion
    provider: v.union(v.literal('google')), // e.g., 'google'
    expiresAt: v.number(), // When this login request expires (15 minutes from creation)
    redirectUri: v.string(), // The OAuth redirect URI used for this login request
  }),

  /**
   * Connect requests for authentication provider account linking flows (e.g., Google OAuth).
   * Tracks the state of a connect attempt and links to sessions and users.
   * Separate from login requests to make flow types explicit and ensure proper validation.
   */
  auth_connectRequests: defineTable({
    sessionId: v.string(), // Session initiating the connect
    status: v.union(v.literal('pending'), v.literal('completed'), v.literal('failed')), // Status of the connect request
    error: v.optional(v.string()), // Error message if failed
    createdAt: v.number(), // Timestamp of creation
    completedAt: v.optional(v.number()), // Timestamp of completion
    provider: v.union(v.literal('google')), // e.g., 'google'
    expiresAt: v.number(), // When this connect request expires (15 minutes from creation)
    redirectUri: v.string(), // The OAuth redirect URI used for this connect request
  }),

  // ============================================================================
  // CHATROOM TABLES
  // Multi-agent chatroom collaboration system
  // ============================================================================

  /**
   * Chatrooms for multi-agent collaboration.
   * Stores chatroom state and team configuration.
   */
  chatroom_rooms: defineTable({
    status: v.union(v.literal('active'), v.literal('completed')),
    // Owner of this chatroom (user ID from session) - required for access control
    ownerId: v.id('users'),
    // Custom chatroom name (user-defined for easier identification)
    name: v.optional(v.string()),
    // Team information
    teamId: v.optional(v.string()),
    teamName: v.optional(v.string()),
    teamRoles: v.optional(v.array(v.string())),
    // Entry point role that receives all user messages (defaults to first role)
    teamEntryPoint: v.optional(v.string()),
    // Last activity timestamp - updated when messages are sent
    // Used for sorting chatrooms by recent activity
    lastActivityAt: v.optional(v.number()),
    // Atomic counter for task queue positions
    // Incremented atomically when creating tasks to prevent race conditions
    // Optional for backward compatibility - defaults to 0 for existing chatrooms
    nextQueuePosition: v.optional(v.number()),
    // Current active context for this chatroom (explicit context management)
    currentContextId: v.optional(v.id('chatroom_contexts')),
    // @deprecated — legacy field kept for backward compatibility with existing documents
    messageCount: v.optional(v.number()),
  })
    .index('by_status', ['status'])
    .index('by_ownerId', ['ownerId'])
    .index('by_ownerId_lastActivity', ['ownerId', 'lastActivityAt']),

  /**
   * Explicit contexts for chatroom conversations.
   * Replaces the fragile pinned message system with explicit context management.
   * Allows users/agents to create, list, and inspect conversation contexts.
   */
  chatroom_contexts: defineTable({
    chatroomId: v.id('chatroom_rooms'),
    // Content summary of the context (provided by user or agent)
    content: v.string(),
    // Who created this context (role name, e.g. 'user', 'planner', 'builder')
    createdBy: v.string(),
    // When the context was created
    createdAt: v.number(),
    // Optional reference to message that triggered context creation
    triggerMessageId: v.optional(v.id('chatroom_messages')),
    // Track message count at context creation time (for staleness detection)
    messageCountAtCreation: v.optional(v.number()),
  })
    .index('by_chatroom', ['chatroomId'])
    .index('by_chatroom_latest', ['chatroomId', 'createdAt']),

  /**
   * Participants in chatrooms.
   * Tracks which agents/users have joined and their presence.
   */
  chatroom_participants: defineTable({
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    // Unique connection ID for the current get-next-task session
    // Used to detect concurrent get-next-task processes and terminate old ones
    // When a new get-next-task starts, it generates a new connectionId
    // The old process detects the mismatch and exits cleanly
    connectionId: v.optional(v.string()),
    // Agent type — 'custom' or 'remote'
    agentType: v.optional(v.union(v.literal('custom'), v.literal('remote'))),
    // Timestamp of the last check-in received from this participant.
    // Populated by participants.join on every check-in.
    lastSeenAt: v.optional(v.number()),
    // The name of the CLI command last run by this participant.
    // For get-next-task (persistent connection), two distinct action names are used:
    //   "get-next-task:started" — written when the loop begins
    //   "get-next-task:stopped" — written just before the loop exits
    lastSeenAction: v.optional(v.string()),
    // @deprecated No longer used for stuck detection. The daemon's task monitor now uses
    // spawnedAgentPid to determine if an agent is running, not token timestamps.
    // Kept for backward compatibility with existing documents.
    lastSeenTokenAt: v.optional(v.number()),
    // @deprecated Denormalized mirror of the latest event stream event type for this participant.
    // Written alongside every event stream insert so the frontend can derive agent status
    // from the participant record alone (without querying the event stream).
    // Prefer reading agent status from chatroom_teamAgentConfigs (via AgentRoleView.state)
    // which is the authoritative source for agent lifecycle state.
    lastStatus: v.optional(v.string()),
    // @deprecated Denormalized mirror of desiredState from chatroom_teamAgentConfigs.
    // Written when start-agent or stop-agent use cases change desiredState.
    // Prefer reading desiredState directly from chatroom_teamAgentConfigs.
    lastDesiredState: v.optional(v.string()),
  })
    .index('by_chatroom', ['chatroomId'])
    .index('by_chatroom_and_role', ['chatroomId', 'role']),

  /**
   * Messages in chatrooms.
   * Supports targeted messages, broadcasts, and handoffs.
   */
  chatroom_messages: defineTable({
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    content: v.string(),
    targetRole: v.optional(v.string()),
    // For broadcast messages, this gets set when the message is claimed
    claimedByRole: v.optional(v.string()),
    // Source platform for messages from external integrations (e.g. "telegram")
    // Used for loop prevention — messages with a sourcePlatform are not re-forwarded.
    sourcePlatform: v.optional(v.string()),
    type: v.union(
      v.literal('message'),
      v.literal('handoff'),
      v.literal('join'), // Deprecated: no longer created, kept for backwards compat with existing data
      v.literal('progress'),
      v.literal('new-context') // Displayed when a new context is created
    ),
    // Classification of user messages (set via task read / classify)
    // Used to determine allowed handoff paths and context window
    classification: v.optional(
      v.union(
        v.literal('question'), // Quick question - can hand directly back to user
        v.literal('new_feature'), // New feature request - must go through reviewer
        v.literal('follow_up') // Follow-up to previous message - part of same context
      )
    ),
    // Feature metadata (set for new_feature classification)
    featureTitle: v.optional(v.string()),
    featureDescription: v.optional(v.string()),
    featureTechSpecs: v.optional(v.string()),
    // Reference to the original user message that started this task chain
    // Set when an agent runs task read / classify, links all related messages
    taskOriginMessageId: v.optional(v.id('chatroom_messages')),
    // Link to the task created for this message (for user messages)
    // Used to track processing status in the UI
    taskId: v.optional(v.id('chatroom_tasks')),

    // Attached backlog tasks for context
    // User can attach multiple backlog tasks to a message for agent context
    // Attached tasks remain in 'backlog' status until agent hands off to user,
    // at which point they transition to 'pending_user_review'
    attachedTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),
    attachedBacklogItemIds: v.optional(v.array(v.id('chatroom_backlog'))),

    // Attached artifacts for context
    // Agents can attach multiple artifacts to handoffs for reference
    attachedArtifactIds: v.optional(v.array(v.id('chatroom_artifacts'))),

    // Attached chatroom messages for context
    // User can attach existing messages as context for a new message
    attachedMessageIds: v.optional(v.array(v.id('chatroom_messages'))),

    // Attached workflows for context
    // Agents can attach workflow IDs to messages for visualizer display
    attachedWorkflowIds: v.optional(v.array(v.id('chatroom_workflows'))),

    // Message lifecycle tracking
    // acknowledgedAt: When an agent received and started working on this message
    acknowledgedAt: v.optional(v.number()),
    // completedAt: When the agent completed work on this message (via handoff)
    completedAt: v.optional(v.number()),
  })
    .index('by_chatroom', ['chatroomId'])
    .index('by_taskId', ['taskId'])
    // Note: _creationTime is automatically appended to all indexes by Convex,
    // so 'by_chatroom' on ['chatroomId'] enables efficient time-range queries.
    // Index for efficient origin message lookup (non-follow-up user messages)
    // Fields ordered: chatroomId (always filtered) → senderRole ('user') → type ('message') → _creationTime (ordering)
    .index('by_chatroom_senderRole_type_createdAt', ['chatroomId', 'senderRole', 'type']),

  /**
   * Staging table for queued user messages.
   * Messages are stored here when received while a task is active.
   * On promotion, the message is copied to chatroom_messages and a task is created.
   * This ensures messages appear in chat history in task processing order.
   */
  /**
   * Materialized task counts per chatroom.
   * Updated atomically by task/backlog/queue mutations to avoid expensive full-table scans.
   * Falls back to computed counts if no record exists (migration safety).
   */
  chatroom_taskCounts: defineTable({
    chatroomId: v.id('chatroom_rooms'),
    pending: v.number(),
    acknowledged: v.number(),
    inProgress: v.number(),
    completed: v.number(),
    queueSize: v.number(),
    backlogCount: v.number(),
    pendingReviewCount: v.number(),
  })
    .index('by_chatroom', ['chatroomId']),

  chatroom_messageQueue: defineTable({
    // Which chatroom this queued message belongs to
    chatroomId: v.id('chatroom_rooms'),
    // Who sent this message (always 'user' for queued messages)
    senderRole: v.string(),
    // Routing target (the role that will process this message)
    targetRole: v.optional(v.string()),
    // Message content
    content: v.string(),
    // Always 'message' — only user messages get staged
    type: v.literal('message'),
    // Attached backlog tasks for context
    attachedTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),
    // Attached backlog items for context
    attachedBacklogItemIds: v.optional(v.array(v.id('chatroom_backlog'))),
    // Attached artifacts
    attachedArtifactIds: v.optional(v.array(v.id('chatroom_artifacts'))),
    // Attached chatroom messages for context
    attachedMessageIds: v.optional(v.array(v.id('chatroom_messages'))),
    // Attached workflows for context
    attachedWorkflowIds: v.optional(v.array(v.id('chatroom_workflows'))),
    // Queue ordering (lower = earlier in queue, older message)
    queuePosition: v.number(),
  })
    .index('by_chatroom', ['chatroomId'])
    .index('by_chatroom_queue', ['chatroomId', 'queuePosition']),

  /**
   * Tasks in chatrooms for queue management.
   * Tracks task lifecycle from creation through completion.
   * Only one task can be pending or in_progress at a time per chatroom.
   *
   * Task workflow: pending → acknowledged → in_progress → completed
   */
  chatroom_tasks: defineTable({
    chatroomId: v.id('chatroom_rooms'),
    createdBy: v.string(), // 'user' or role name that created the task

    // Content (plain text only)
    content: v.string(),

    // Status tracking
    status: v.union(
      v.literal('pending'), // Ready for agent to pick up
      v.literal('acknowledged'), // Agent claimed task via get-next-task, not yet started
      v.literal('in_progress'), // Agent actively working on it
      v.literal('completed'), // Finished successfully

      // @deprecated — legacy backlog-origin statuses; exist in old records, remove after cleanup migration
      v.literal('closed'), // @deprecated — was terminal status for backlog tasks; now handled by chatroom_backlog
      v.literal('backlog'), // @deprecated — was initial status for backlog items; now handled by chatroom_backlog
      v.literal('pending_user_review'), // @deprecated — was intermediate backlog status; now handled by chatroom_backlog
      v.literal('backlog_acknowledged') // @deprecated — transitional status, migrated via migrateBacklogAcknowledgedToBacklog
    ),

    // Assignment
    assignedTo: v.optional(v.string()), // Role assigned to work on this

    // Link to source message (for auto-created tasks from user messages)
    sourceMessageId: v.optional(v.id('chatroom_messages')),

    // Backlog attachment tracking
    // @deprecated — backlog-specific field; use chatroom_backlog references instead
    attachedTaskIds: v.optional(v.array(v.id('chatroom_tasks'))), // Backlog tasks attached to this task

    // @deprecated — origin was used to distinguish backlog vs chat tasks; all backlog items
    // are now in chatroom_backlog. Remove after running the reference cleanup migration.
    origin: v.optional(
      v.union(
        v.literal('backlog'), // @deprecated — all backlog items are now in chatroom_backlog table
        v.literal('chat') // Created from chat message
      )
    ),

    // @deprecated — backlog scoring fields; now on chatroom_backlog. Remove after cleanup.
    complexity: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
    value: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
    priority: v.optional(v.number()),

    // @deprecated — bidirectional link to parent backlog task. Remove after reference cleanup migration.
    parentTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
    acknowledgedAt: v.optional(v.number()), // When agent claimed task via get-next-task
    startedAt: v.optional(v.number()), // When task read was called
    completedAt: v.optional(v.number()), // When task-complete was called

    // Queue ordering (lower = earlier in queue)
    queuePosition: v.number(),
  })
    .index('by_chatroom', ['chatroomId'])
    .index('by_chatroom_status', ['chatroomId', 'status'])
    .index('by_chatroom_status_assignedTo', ['chatroomId', 'status', 'assignedTo'])
    .index('by_chatroom_queue', ['chatroomId', 'queuePosition']),

  /**
   * Backlog items for chatroom planning.
   * Long-lived planning items managed by the user, separate from active task queue.
   *
   * Lifecycle: backlog → pending_user_review → closed (or deleted)
   *
   * Items are promoted to chatroom_tasks when the user decides to execute them.
   */
  chatroom_backlog: defineTable({
    chatroomId: v.id('chatroom_rooms'),
    createdBy: v.string(), // 'user' or role name that created the item

    // Content (plain text only)
    content: v.string(),

    // Status lifecycle
    status: v.union(
      v.literal('backlog'), // Sitting in the backlog, awaiting pickup
      v.literal('pending_user_review'), // Agent completed work, awaiting user confirmation
      v.literal('closed') // User closed without completing
    ),

    // Assignment (when an agent is working on this item)
    assignedTo: v.optional(v.string()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),

    // Scoring fields for prioritization
    // Complexity: low = easy to implement, high = complex/risky
    complexity: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
    // Value: low = nice-to-have, high = critical/high-impact
    value: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
    // Priority: numeric priority for flexible ordering (higher = more important)
    priority: v.optional(v.number()),

    // Close reason — mandatory when closing via CLI, for audit trail
    closeReason: v.optional(v.string()),

    // Legacy reference — set during migration from chatroom_tasks
    // Used to remap attachedTaskIds/parentTaskIds in messages and tasks
    // @deprecated — migration reference from Phase 1; can be removed after Phase 5 (reference cleanup)
    legacyTaskId: v.optional(v.id('chatroom_tasks')),
  })
    .index('by_chatroom', ['chatroomId'])
    .index('by_chatroom_status', ['chatroomId', 'status'])
    .index('by_chatroom_priority', ['chatroomId', 'priority'])
    .index('by_legacy_task_id', ['legacyTaskId']),

  // ============================================================================
  // CLI AUTHENTICATION TABLES
  // Device authorization flow for CLI tools
  // ============================================================================

  /**
   * CLI auth requests for device authorization flow.
   * When a CLI runs `chatroom auth login`, it creates a pending auth request
   * and polls for approval. User approves via web browser.
   */
  cliAuthRequests: defineTable({
    // Unique request ID (generated by CLI, used for polling)
    requestId: v.string(),
    // Status of the auth request
    status: v.union(
      v.literal('pending'), // Waiting for user approval in browser
      v.literal('approved'), // User approved, session generated
      v.literal('denied'), // User denied the request
      v.literal('expired') // Request timed out (5 minutes)
    ),
    // The session ID generated upon approval (null until approved)
    sessionId: v.optional(v.string()),
    // User who approved the request (set upon approval)
    approvedBy: v.optional(v.id('users')),
    // Device/CLI metadata for user to verify
    deviceName: v.optional(v.string()),
    cliVersion: v.optional(v.string()),
    // Timestamps
    createdAt: v.number(),
    expiresAt: v.number(), // 5 minutes from creation
    approvedAt: v.optional(v.number()),
  })
    .index('by_requestId', ['requestId'])
    .index('by_status', ['status']),

  /**
   * CLI sessions for authenticated CLI tools.
   * Created when a CLI auth request is approved.
   * Validated on every CLI command.
   */
  cliSessions: defineTable({
    // The session ID (stored in ~/.chatroom/auth.jsonc)
    sessionId: v.string(),
    // User who owns this session
    userId: v.id('users'),
    // Whether the session is still valid
    isActive: v.boolean(),
    // Device/CLI metadata
    deviceName: v.optional(v.string()),
    cliVersion: v.optional(v.string()),
    // Timestamps
    createdAt: v.number(),
    lastUsedAt: v.number(),
    // Optional expiry (null = no expiry, just manual revocation)
    expiresAt: v.optional(v.number()),
    // Revocation info
    revokedAt: v.optional(v.number()),
    revokedReason: v.optional(v.string()),
  })
    .index('by_sessionId', ['sessionId'])
    .index('by_userId', ['userId'])
    .index('by_userId_active', ['userId', 'isActive']),

  /**
   * User favorites for chatrooms.
   * Tracks which chatrooms a user has marked as favorite for quick access.
   */
  chatroom_favorites: defineTable({
    chatroomId: v.id('chatroom_rooms'),
    userId: v.id('users'),
    createdAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_chatroomId', ['userId', 'chatroomId'])
    .index('by_chatroomId', ['chatroomId']),

  /**
   * Read cursors for tracking the last message a user has seen in each chatroom.
   * Used to compute unread indicators efficiently without subscribing to full message history.
   * One record per user per chatroom.
   */
  /**
   * Materialized per-user per-chatroom unread status.
   * Updated on message insert (set unread) and markAsRead (clear unread).
   * Replaces the expensive N+1 computation in listUnreadStatus.
   */
  chatroom_unreadStatus: defineTable({
    chatroomId: v.id('chatroom_rooms'),
    userId: v.string(),
    hasUnread: v.boolean(),
    hasUnreadHandoff: v.boolean(),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_chatroomId', ['userId', 'chatroomId']),

  chatroom_read_cursors: defineTable({
    chatroomId: v.id('chatroom_rooms'),
    userId: v.id('users'),
    // Timestamp of the last message the user has seen (compared against message _creationTime)
    lastSeenAt: v.number(),
    // When this cursor was last updated
    updatedAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_chatroomId', ['userId', 'chatroomId']),

  /**
   * Artifacts for chatroom collaboration.
   * Stores versioned documents that can be attached to handoffs.
   */
  chatroom_artifacts: defineTable({
    chatroomId: v.id('chatroom_rooms'),

    // Artifact identity (stable across versions)
    artifactGroupId: v.string(), // UUID linking all versions

    // Artifact metadata
    filename: v.string(),
    description: v.optional(v.string()),
    mimeType: v.optional(v.string()), // Defaults to 'text/markdown' in mutations

    // Content
    content: v.string(),

    // Version tracking
    version: v.number(), // 1, 2, 3...
    isLatest: v.boolean(), // true for current version
    previousVersionId: v.optional(v.id('chatroom_artifacts')),

    // Tracking
    createdBy: v.string(),
    createdAt: v.number(),
  })
    .index('by_chatroom', ['chatroomId'])
    .index('by_group_latest', ['artifactGroupId', 'isLatest'])
    .index('by_chatroom_and_filename_latest', ['chatroomId', 'filename', 'isLatest']),

  // ============================================================================
  // AGENT PREFERENCE TABLES
  // User's preferred remote agent configuration per chatroom+role
  // ============================================================================

  /**
   * User preferences for remote agent configuration per chatroom and role.
   * Stores the last-used (or explicitly saved) machine, harness, model, and
   * working directory so the Remote tab in the UI pre-populates these values
   * as sensible defaults when the user opens it.
   *
   * This is separate from chatroom_teamAgentConfigs, which is the authoritative
   * active config used by auto-restart logic. agentPreferences are purely
   * informational/UI hints — they do not drive any backend behavior.
   *
   * Written by: the UI's "Start Agent" action (via saveAgentPreference mutation).
   * Read by: the Remote tab UI to pre-populate fields as defaults.
   */
  chatroom_agentPreferences: defineTable({
    // Owner of this preference (user who clicked Start Agent)
    userId: v.id('users'),
    // Chatroom this preference applies to
    chatroomId: v.id('chatroom_rooms'),
    // Role this preference is for (e.g. "planner", "builder")
    // DEPRECATED SHAPE: old documents (pre-migration) may be missing this field.
    // See migration.migrateAgentPreferencesToPerRole for cleanup.
    role: v.optional(v.string()),
    // Preferred machine ID
    machineId: v.string(),
    // Preferred agent harness
    // DEPRECATED SHAPE: old documents (pre-migration) may be missing this field.
    // See migration.migrateAgentPreferencesToPerRole for cleanup.
    agentHarness: v.optional(agentHarnessValidator),
    // Preferred AI model
    model: v.optional(v.string()),
    // Preferred working directory (absolute path on the machine)
    workingDir: v.optional(v.string()),
    // When this preference was last saved
    updatedAt: v.number(),
    // When this preference was first created
    // DEPRECATED SHAPE: old documents (pre-migration) may be missing this field.
    createdAt: v.optional(v.number()),
    // DEPRECATED SHAPE: old documents (pre-migration) may have these role-map fields
    // instead of the per-role `agentHarness` and `role` fields.
    // See migration.deleteOldFormatAgentPreferences for cleanup.
    // These fields must remain in the schema until the migration has run in production.
    harnessByRole: v.optional(
      v.record(v.string(), v.union(v.literal('opencode'), v.literal('pi')))
    ),
    modelByRole: v.optional(v.record(v.string(), v.string())),
  })
    .index('by_userId_chatroom_role', ['userId', 'chatroomId', 'role'])
    .index('by_chatroom', ['chatroomId']),

  // ============================================================================
  // MACHINE MANAGEMENT TABLES
  // Remote machine identity and command execution
  // ============================================================================

  /**
   * Registered machines for remote agent management.
   * Each machine has a stable UUID and is owned by a user.
   */
  chatroom_machines: defineTable({
    // UUID generated by CLI (stored in ~/.chatroom/machine.json)
    machineId: v.string(),
    // Owner user ID (from authenticated CLI session)
    userId: v.id('users'),
    // Machine hostname
    hostname: v.string(),
    // Optional user-defined display name for this machine
    alias: v.optional(v.string()),
    // Operating system (darwin, linux, win32)
    os: v.string(),
    // Available agent harnesses on this machine
    availableHarnesses: v.array(agentHarnessValidator),
    // Detected harness versions (keyed by harness name, e.g. { opencode: { version: "1.2.3", major: 1 } })
    harnessVersions: v.optional(
      v.record(
        v.string(),
        v.object({
          version: v.string(),
          major: v.number(),
        })
      )
    ),
    // Available AI models discovered per harness (dynamic, per-machine)
    // Shape: { opencode: [...], pi: [...] }
    // DEPRECATED SHAPE: v.array(v.string()) — kept to pass validation until
    // migration.migrateAvailableModelsToPerHarness has run. Remove after migration.
    availableModels: v.optional(
      v.union(v.record(v.string(), v.array(v.string())), v.array(v.string()))
    ),
    // When machine was first registered
    registeredAt: v.number(),
    // Last sync/heartbeat from CLI
    lastSeenAt: v.number(),
    // Whether daemon is currently connected (for UI status display)
    daemonConnected: v.boolean(),
  })
    // machineId is client-generated (UUID). Convex doesn't support unique indexes,
    // so uniqueness is enforced at the application layer in register() mutation.
    // Convex mutations are serializable, so the check-then-insert is race-safe.
    .index('by_machineId', ['machineId'])
    .index('by_userId', ['userId']),

  /**
   * Machine liveness data — volatile fields separated from the main machine record
   * to prevent heartbeat-triggered cascading re-evaluations.
   *
   * Updated by daemonHeartbeat on every heartbeat. Queries that only need static
   * machine info (hostname, harnesses, etc.) read from chatroom_machines and
   * won't re-trigger when liveness data changes.
   */
  chatroom_machineLiveness: defineTable({
    machineId: v.string(),
    lastSeenAt: v.number(),
    daemonConnected: v.boolean(),
  })
    .index('by_machineId', ['machineId']),

  /**
   * Materialized machine online/offline status.
   * Written only on actual state transitions to avoid subscription invalidation.
   * The cron job transitions online→offline; daemonHeartbeat transitions offline→online.
   */
  chatroom_machineStatus: defineTable({
    machineId: v.string(),
    status: v.union(v.literal('online'), v.literal('offline')),
    lastTransitionAt: v.number(),
  })
    .index('by_machineId', ['machineId'])
    .index('by_status', ['status']),

  /**
   * Model visibility filters for a machine's harness.
   * Machine-level — shared across all users and chatrooms.
   * Hidden models appear greyed-out in the UI but are still visible.
   */
  chatroom_machineModelFilters: defineTable({
    // Machine these filters apply to
    machineId: v.string(),
    // Harness these filters apply to
    agentHarness: agentHarnessValidator,
    // Individual model IDs to hide (e.g. "github-copilot/claude-haiku-4.5")
    hiddenModels: v.array(v.string()),
    // Provider prefixes to hide all models for (e.g. "github-copilot")
    hiddenProviders: v.array(v.string()),
    // Last updated
    updatedAt: v.number(),
  }).index('by_machine_harness', ['machineId', 'agentHarness']),

  /**
   * Team-level agent configuration.
   * Tracks how agents for each team/role are configured to start.
   * Used by auto-restart logic to determine if an agent should be auto-restarted.
   *
   * When type is 'remote', the config contains machine/harness/model info
   * needed to restart the agent via the daemon.
   * When type is 'custom' (or no config exists), auto-restart is skipped.
   */
  chatroom_teamAgentConfigs: defineTable({
    // Unique key: chatroom_<chatroomId>#team_<teamId>#role_<role>
    teamRoleKey: v.string(),

    // Reference to the chatroom (for cascading deletes/queries)
    chatroomId: v.id('chatroom_rooms'),

    // The role this config is for
    role: v.string(),

    // Config type discriminator
    type: v.union(v.literal('remote'), v.literal('custom')),

    // Remote agent config (only present when type === 'remote')
    machineId: v.optional(v.string()),
    agentHarness: v.optional(agentHarnessValidator),
    model: v.optional(v.string()),
    workingDir: v.optional(v.string()),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),

    // Desired state for this agent (used by ensureAgentHandler to skip auto-restart)
    desiredState: v.optional(v.union(v.literal('running'), v.literal('stopped'))),

    // Circuit breaker state
    circuitState: v.optional(
      v.union(v.literal('closed'), v.literal('open'), v.literal('half-open'))
    ),
    circuitOpenedAt: v.optional(v.number()),

    spawnedAgentPid: v.optional(v.number()),
    spawnedAt: v.optional(v.number()),
  })
    .index('by_teamRoleKey', ['teamRoleKey'])
    .index('by_chatroom', ['chatroomId'])
    .index('by_machineId', ['machineId']),

  // ============================================================================
  // EVENT STREAM TABLE
  // Append-only log of all significant events in the chatroom system.
  // Used for crash recovery, audit, and daemon-driven reactions.
  // ============================================================================

  /**
   * Immutable event log for the chatroom system.
   * Each row represents one discrete event. Consumers read forward from a
   * checkpoint and react to events without fetching additional data.
   */
  chatroom_eventStream: defineTable(
    v.union(
      // Agent spawned successfully
      v.object({
        type: v.literal('agent.started'),
        chatroomId: v.id('chatroom_rooms'),
        role: v.string(),
        machineId: v.string(),
        agentHarness: agentHarnessValidator,
        model: v.string(),
        workingDir: v.string(),
        pid: v.number(),
        reason: v.optional(v.string()),
        timestamp: v.number(),
      }),
      // Agent process exited (crash or intentional)
      v.object({
        type: v.literal('agent.exited'),
        chatroomId: v.id('chatroom_rooms'),
        role: v.string(),
        machineId: v.string(),
        pid: v.number(),
        stopReason: v.optional(v.string()),
        stopSignal: v.optional(v.string()),
        exitCode: v.optional(v.number()),
        signal: v.optional(v.string()),
        /** @deprecated Legacy field from before StopReason migration. Retained for schema compatibility with old documents. */
        intentional: v.optional(v.boolean()),
        timestamp: v.number(),
      }),
      // Agent circuit breaker tripped
      v.object({
        type: v.literal('agent.circuitOpen'),
        chatroomId: v.id('chatroom_rooms'),
        role: v.string(),
        machineId: v.string(),
        reason: v.string(),
        timestamp: v.number(),
      }),
      // Task entered an active state needing an agent
      v.object({
        type: v.literal('task.activated'),
        chatroomId: v.id('chatroom_rooms'),
        taskId: v.id('chatroom_tasks'),
        role: v.string(),
        machineId: v.optional(v.string()),
        taskStatus: v.string(),
        taskContent: v.string(),
        timestamp: v.number(),
      }),
      // Task reached a terminal state
      v.object({
        type: v.literal('task.completed'),
        chatroomId: v.id('chatroom_rooms'),
        taskId: v.id('chatroom_tasks'),
        role: v.string(),
        machineId: v.optional(v.string()),
        finalStatus: v.string(),
        timestamp: v.number(),
        // When true, consumers should skip using this event to update agent status.
        // Set for externally force-completed tasks where the agent process may still be running.
        skipAgentStatusUpdate: v.optional(v.boolean()),
      }),
      // An agent start was requested (replaces command.startAgent; includes deadline)
      v.object({
        type: v.literal('agent.requestStart'),
        chatroomId: v.id('chatroom_rooms'),
        machineId: v.string(),
        role: v.string(),
        agentHarness: agentHarnessValidator,
        model: v.string(),
        workingDir: v.string(),
        reason: v.string(),
        deadline: v.number(),
        timestamp: v.number(),
      }),
      // An agent stop was requested (replaces command.stopAgent; includes deadline)
      v.object({
        type: v.literal('agent.requestStop'),
        chatroomId: v.id('chatroom_rooms'),
        machineId: v.string(),
        role: v.string(),
        reason: v.string(),
        deadline: v.number(),
        timestamp: v.number(),
        pid: v.optional(v.number()),
      }),
      // Agent declared its type for a chatroom role (custom or remote)
      v.object({
        type: v.literal('agent.registered'),
        chatroomId: v.id('chatroom_rooms'),
        role: v.string(),
        agentType: v.union(v.literal('custom'), v.literal('remote')),
        machineId: v.optional(v.string()),
        timestamp: v.number(),
      }),
      // Agent entered the get-next-task loop (standing by for tasks)
      v.object({
        type: v.literal('agent.waiting'),
        chatroomId: v.id('chatroom_rooms'),
        role: v.string(),
        machineId: v.optional(v.string()),
        timestamp: v.number(),
      }),
      // Agent claimed a pending task via get-next-task (pending → acknowledged)
      v.object({
        type: v.literal('task.acknowledged'),
        chatroomId: v.id('chatroom_rooms'),
        role: v.string(),
        taskId: v.id('chatroom_tasks'),
        timestamp: v.number(),
      }),
      // Agent began active work via task read / classify (acknowledged → in_progress)
      v.object({
        type: v.literal('task.inProgress'),
        chatroomId: v.id('chatroom_rooms'),
        role: v.string(),
        taskId: v.id('chatroom_tasks'),
        timestamp: v.number(),
      }),
      // UI-initiated ping to verify daemon connectivity
      v.object({
        type: v.literal('daemon.ping'),
        machineId: v.string(),
        timestamp: v.number(),
      }),
      // UI-initiated git state refresh request
      v.object({
        type: v.literal('daemon.gitRefresh'),
        machineId: v.string(),
        workingDir: v.string(),
        timestamp: v.number(),
      }),
      // Daemon response to a daemon.ping event
      v.object({
        type: v.literal('daemon.pong'),
        machineId: v.string(),
        pingEventId: v.id('chatroom_eventStream'),
        timestamp: v.number(),
      }),
      // Request to remove a teamAgentConfig after the agent process exits
      v.object({
        type: v.literal('config.requestRemoval'),
        chatroomId: v.id('chatroom_rooms'),
        role: v.string(),
        machineId: v.string(),
        reason: v.string(),
        timestamp: v.number(),
      }),
      // A skill was activated for a role in this chatroom
      v.object({
        type: v.literal('skill.activated'),
        chatroomId: v.id('chatroom_rooms'),
        skillId: v.string(),
        skillName: v.string(),
        role: v.string(),
        prompt: v.string(),
        timestamp: v.number(),
      }),
      // Daemon failed to start an agent process
      v.object({
        type: v.literal('agent.startFailed'),
        chatroomId: v.id('chatroom_rooms'),
        role: v.string(),
        machineId: v.string(),
        error: v.string(),
        timestamp: v.number(),
      }),
      // Daemon hit crash loop limit and stopped restarting
      v.object({
        type: v.literal('agent.restartLimitReached'),
        chatroomId: v.id('chatroom_rooms'),
        role: v.string(),
        machineId: v.string(),
        restartCount: v.number(),
        windowMs: v.number(),
        timestamp: v.number(),
      }),
      // Workflow started (draft → active)
      v.object({
        type: v.literal('workflow.started'),
        chatroomId: v.id('chatroom_rooms'),
        workflowKey: v.string(),
        workflowId: v.id('chatroom_workflows'),
        createdBy: v.string(),
        stepCount: v.number(),
        // Optional for backward compatibility — existing events in the DB may not have this field.
        // New events always include steps.
        steps: v.optional(v.array(
          v.object({
            stepKey: v.string(),
            description: v.string(),
            assigneeRole: v.optional(v.string()),
            dependsOn: v.array(v.string()),
            order: v.number(),
          })
        )),
        timestamp: v.number(),
      }),
      // Workflow step completed
      v.object({
        type: v.literal('workflow.stepCompleted'),
        chatroomId: v.id('chatroom_rooms'),
        workflowKey: v.string(),
        workflowId: v.id('chatroom_workflows'),
        stepKey: v.string(),
        stepDescription: v.optional(v.string()),
        completedBy: v.optional(v.string()),
        timestamp: v.number(),
      }),
      // Workflow step cancelled
      v.object({
        type: v.literal('workflow.stepCancelled'),
        chatroomId: v.id('chatroom_rooms'),
        workflowKey: v.string(),
        workflowId: v.id('chatroom_workflows'),
        stepKey: v.string(),
        stepDescription: v.optional(v.string()),
        cancelledBy: v.optional(v.string()),
        reason: v.string(),
        timestamp: v.number(),
      }),
      // Workflow completed (all steps terminal)
      v.object({
        type: v.literal('workflow.completed'),
        chatroomId: v.id('chatroom_rooms'),
        workflowKey: v.string(),
        workflowId: v.id('chatroom_workflows'),
        finalStatus: v.union(v.literal('completed'), v.literal('cancelled')),
        timestamp: v.number(),
      }),
      // Workflow created (new draft workflow)
      v.object({
        type: v.literal('workflow.created'),
        chatroomId: v.id('chatroom_rooms'),
        workflowKey: v.string(),
        workflowId: v.id('chatroom_workflows'),
        createdBy: v.string(),
        stepCount: v.number(),
        steps: v.optional(v.array(
          v.object({
            stepKey: v.string(),
            description: v.string(),
            assigneeRole: v.optional(v.string()),
            dependsOn: v.array(v.string()),
            order: v.number(),
          })
        )),
        timestamp: v.number(),
      }),
      // Workflow step specified
      v.object({
        type: v.literal('workflow.specified'),
        chatroomId: v.id('chatroom_rooms'),
        workflowKey: v.string(),
        workflowId: v.id('chatroom_workflows'),
        stepKey: v.string(),
        timestamp: v.number(),
      }),
      // Workflow step started (transitioned to in_progress)
      v.object({
        type: v.literal('workflow.stepStarted'),
        chatroomId: v.id('chatroom_rooms'),
        workflowKey: v.string(),
        workflowId: v.id('chatroom_workflows'),
        stepKey: v.string(),
        stepDescription: v.optional(v.string()),
        assigneeRole: v.optional(v.string()),
        timestamp: v.number(),
      }),
      // Daemon local action request (open-vscode, open-finder, etc.) sent via Convex
      // instead of direct localhost HTTP to work around Safari mixed-content blocking.
      // NOTE: When adding new action types, also update the canonical TypeScript type
      // in config/localActions.ts (LocalActionType).
      v.object({
        type: v.literal('daemon.localAction'),
        machineId: v.string(),
        action: v.union(
          v.literal('open-vscode'),
          v.literal('open-finder'),
          v.literal('open-github-desktop')
        ),
        workingDir: v.string(),
        timestamp: v.number(),
      }),
      // Request to run a command on a machine (dispatched from web UI)
      v.object({
        type: v.literal('command.run'),
        machineId: v.string(),
        workingDir: v.string(),
        commandName: v.string(),
        script: v.string(),
        runId: v.id('chatroom_commandRuns'),
        timestamp: v.number(),
      }),
      // Request to stop a running command on a machine
      v.object({
        type: v.literal('command.stop'),
        machineId: v.string(),
        runId: v.id('chatroom_commandRuns'),
        timestamp: v.number(),
      })
    )
  )
    .index('by_chatroom', ['chatroomId'])
    .index('by_chatroom_type', ['chatroomId', 'type'])
    .index('by_chatroomId_role', ['chatroomId', 'role'])
    .index('by_machineId_type', ['machineId', 'type'])
    .index('by_timestamp', ['timestamp']),

  /**
   * Pre-aggregated agent restart metrics.
   * Incremented atomically each time an agent starts (via updateSpawnedAgent mutation).
   * Used for efficient hourly-granularity restart tracking without scanning chatroom_eventStream.
   *
   * hourBucket: Unix timestamp of the start of the hour (UTC), e.g.:
   *   new Date('2026-03-06T16:00:00Z').getTime() → 1741276800000
   *   Formula: Math.floor(Date.now() / 3_600_000) * 3_600_000
   */
  chatroom_agentRestartMetrics: defineTable({
    // Identity fields
    machineId: v.string(),
    role: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    workingDir: v.string(),
    model: v.string(), // e.g. "github-copilot/claude-sonnet-4.5"
    agentType: v.optional(v.string()), // e.g. "pi", "cursor", "opencode" — optional for backward compat

    // Time bucket (start of the hour in ms UTC)
    hourBucket: v.number(),

    // Metric value (number of agent starts in this bucket)
    count: v.number(),
  })
    // Query: machine + role across all chatrooms, time range (for "all chatrooms" view)
    .index('by_machine_role_hour', ['machineId', 'role', 'hourBucket'])

    // Query: chatroom + role, time range (for "this chatroom" breakdown)
    .index('by_chatroom_role_hour', ['chatroomId', 'role', 'hourBucket'])

    // Query: workspace (machineId+workingDir) + role, time range (for workspace breakdown)
    .index('by_workspace_role_hour', ['machineId', 'workingDir', 'role', 'hourBucket']),

  /**
   * Workspace git state pushed by the daemon on heartbeat.
   * Stores branch, dirty status, diff stats, and recent commits.
   * Keyed by machineId + workingDir (workspace-level, not chatroom-level).
   */
  chatroom_workspaceGitState: defineTable({
    // Identity: unique workspace
    machineId: v.string(),
    workingDir: v.string(),

    // Discriminated union status
    status: v.union(v.literal('available'), v.literal('not_found'), v.literal('error')),

    // Branch info (only when status === 'available')
    branch: v.optional(v.string()),
    isDirty: v.optional(v.boolean()),

    // Diff summary: git diff HEAD --stat (only when status === 'available')
    diffStat: v.optional(
      v.object({
        filesChanged: v.number(),
        insertions: v.number(),
        deletions: v.number(),
      })
    ),

    // Recent commits (only when status === 'available')
    recentCommits: v.optional(
      v.array(
        v.object({
          sha: v.string(),
          shortSha: v.string(),
          message: v.string(),
          author: v.string(),
          date: v.string(),
        })
      )
    ),

    // Pagination
    hasMoreCommits: v.optional(v.boolean()),

    // Open pull requests for the current branch (only when status === 'available')
    openPullRequests: v.optional(
      v.array(
        v.object({
          number: v.number(),
          title: v.string(),
          url: v.string(),
          headRefName: v.string(),
          state: v.string(),
        })
      )
    ),

    // All pull requests (open, closed, merged) for the repository
    allPullRequests: v.optional(
      v.array(
        v.object({
          number: v.number(),
          title: v.string(),
          url: v.string(),
          headRefName: v.string(),
          baseRefName: v.optional(v.string()),
          state: v.string(),
          author: v.optional(v.string()),
          createdAt: v.optional(v.string()),
          updatedAt: v.optional(v.string()),
          mergedAt: v.optional(v.union(v.string(), v.null())),
          closedAt: v.optional(v.union(v.string(), v.null())),
          isDraft: v.optional(v.boolean()),
        })
      )
    ),

    // Git remotes (only when status === 'available')
    remotes: v.optional(
      v.array(
        v.object({
          name: v.string(),
          url: v.string(),
        })
      )
    ),

    // Commits ahead of upstream tracking branch (unpushed)
    commitsAhead: v.optional(v.number()),

    // Default branch name (e.g. 'main', 'master')
    defaultBranch: v.optional(v.union(v.string(), v.null())),

    // CI/CD status checks for the current branch head commit
    headCommitStatus: v.optional(v.union(
      v.object({
        state: v.string(),
        checkRuns: v.array(v.object({
          name: v.string(),
          status: v.string(),
          conclusion: v.union(v.string(), v.null()),
        })),
        totalCount: v.number(),
      }),
      v.null()
    )),

    // CI/CD status checks for the latest default branch commit
    defaultBranchStatus: v.optional(v.union(
      v.object({
        state: v.string(),
        checkRuns: v.array(v.object({
          name: v.string(),
          status: v.string(),
          conclusion: v.union(v.string(), v.null()),
        })),
        totalCount: v.number(),
      }),
      v.null()
    )),

    // Error message (only when status === 'error')
    errorMessage: v.optional(v.string()),

    // Timestamp
    updatedAt: v.number(),
  }).index('by_machine_workingDir', ['machineId', 'workingDir']),

  /**
   * On-demand full diff content for a workspace.
   * Stores the output of `git diff HEAD` (up to 500KB cap).
   * Refreshed when the frontend requests an updated diff.
   */
  chatroom_workspaceFullDiff: defineTable({
    machineId: v.string(),
    workingDir: v.string(),

    // git diff HEAD output (up to 500KB cap)
    diffContent: v.string(),
    truncated: v.boolean(),

    // Stats
    diffStat: v.object({
      filesChanged: v.number(),
      insertions: v.number(),
      deletions: v.number(),
    }),

    updatedAt: v.number(),
  }).index('by_machine_workingDir', ['machineId', 'workingDir']),

  /**
   * Request queue for on-demand workspace operations.
   * The daemon polls this table for pending requests and fulfills them.
   * Supports: full diff, commit detail, and load-more commits.
   */
  chatroom_workspaceDiffRequests: defineTable({
    machineId: v.string(),
    workingDir: v.string(),
    requestType: v.union(
      v.literal('full_diff'),
      v.literal('commit_detail'),
      v.literal('more_commits'),
      v.literal('pr_diff'),
      v.literal('pr_action'),
      v.literal('pr_commits')
    ),
    // For commit_detail requests
    sha: v.optional(v.string()),
    // For more_commits requests
    offset: v.optional(v.number()),
    // For pr_diff requests
    baseBranch: v.optional(v.string()),
    // For pr_action requests
    prAction: v.optional(v.union(v.literal('merge_squash'), v.literal('merge_no_squash'), v.literal('close'))),
    prNumber: v.optional(v.number()),
    // Request status
    status: v.union(
      v.literal('pending'),
      v.literal('processing'),
      v.literal('done'),
      v.literal('error')
    ),
    requestedAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_machine_status', ['machineId', 'status'])
    .index('by_machine_workingDir_type', ['machineId', 'workingDir', 'requestType']),

  /**
   * Stored PR diff content (diff between base branch and HEAD).
   * Populated by the daemon after a `pr_diff` request is fulfilled.
   * Keyed by machineId + workingDir.
   */
  chatroom_workspacePRDiffs: defineTable({
    machineId: v.string(),
    workingDir: v.string(),
    baseBranch: v.string(),
    diffContent: v.string(),
    truncated: v.boolean(),
    diffStat: v.object({
      filesChanged: v.number(),
      insertions: v.number(),
      deletions: v.number(),
    }),
    updatedAt: v.number(),
  }).index('by_machine_workingDir', ['machineId', 'workingDir']),

  /**
   * Cached list of commits for a specific PR.
   * Populated by the daemon after a `pr_commits` request is fulfilled.
   * Keyed by machineId + workingDir + prNumber.
   */
  chatroom_workspacePRCommits: defineTable({
    machineId: v.string(),
    workingDir: v.string(),
    prNumber: v.number(),
    commits: v.array(
      v.object({
        sha: v.string(),
        shortSha: v.string(),
        message: v.string(),
        author: v.string(),
        date: v.string(),
      })
    ),
    updatedAt: v.number(),
  }).index('by_machine_workingDir_prNumber', ['machineId', 'workingDir', 'prNumber']),

  /**
   * Per-commit diff content fetched on demand.
   * Stores the output of `git show <sha>` (up to 500KB cap).
   * Keyed by machineId + workingDir + sha.
   */
  chatroom_workspaceCommitDetail: defineTable({
    machineId: v.string(),
    workingDir: v.string(),
    sha: v.string(),

    // Discriminated union status
    status: v.union(
      v.literal('available'),
      v.literal('too_large'),
      v.literal('error'),
      v.literal('not_found')
    ),

    // Only when status === 'available'
    diffContent: v.optional(v.string()),
    truncated: v.optional(v.boolean()),
    diffStat: v.optional(
      v.object({
        filesChanged: v.number(),
        insertions: v.number(),
        deletions: v.number(),
      })
    ),

    // Commit metadata (available when status === 'available' or 'too_large')
    message: v.optional(v.string()),
    author: v.optional(v.string()),
    date: v.optional(v.string()),

    // Only when status === 'error'
    errorMessage: v.optional(v.string()),

    updatedAt: v.number(),
  }).index('by_machine_workingDir_sha', ['machineId', 'workingDir', 'sha']),

  // ─── Workspace Registry ──────────────────────────────────────────────────────
  // Persistent record of workspaces (machine + working directory pairs) where
  // agents operate. Unlike chatroom_teamAgentConfigs (transient), these persist
  // independently of agent lifecycle.
  chatroom_workspaces: defineTable({
    chatroomId: v.id('chatroom_rooms'),
    machineId: v.string(),
    workingDir: v.string(),
    hostname: v.string(),
    registeredAt: v.number(),
    registeredBy: v.string(), // role that first registered this workspace
    removedAt: v.optional(v.number()), // soft delete timestamp
  })
    .index('by_chatroom', ['chatroomId'])
    .index('by_machine', ['machineId'])
    .index('by_chatroom_machine_workingDir', ['chatroomId', 'machineId', 'workingDir']),

  // ─── Workspace File Tree ─────────────────────────────────────────────────────
  // Stores file tree snapshots and on-demand file content per workspace.

  /**
   * File tree snapshot for a workspace.
   * Stores the entire tree as a single JSON blob to avoid per-file row overhead.
   * Keep under Convex's 1MB document limit (~10,000 entries max).
   */
  chatroom_workspaceFileTree: defineTable({
    machineId: v.string(),
    workingDir: v.string(),

    // JSON blob of FileTree (entries array + metadata)
    treeJson: v.string(),

    // Base64-encoded gzip-compressed treeJson (used when compression is set)
    treeJsonCompressed: v.optional(v.string()),

    // Compression format marker
    compression: v.optional(v.literal('gzip')),

    // Hash of treeJson for server-side dedup (skips write if unchanged)
    treeHash: v.optional(v.string()),

    // When the tree was last scanned
    scannedAt: v.number(),
  }).index('by_machine_workingDir', ['machineId', 'workingDir']),

  /**
   * On-demand file content cache.
   * Stores content for individual files fetched by the frontend.
   * Content capped at 500KB per file.
   */
  chatroom_workspaceFileContent: defineTable({
    machineId: v.string(),
    workingDir: v.string(),
    filePath: v.string(),

    // File content (max 500KB)
    content: v.string(),
    encoding: v.string(), // 'utf8'
    truncated: v.boolean(),

    // When the content was fetched
    fetchedAt: v.number(),
  }).index('by_machine_workingDir_path', ['machineId', 'workingDir', 'filePath']),

  /**
   * Pending file content requests.
   * Frontend creates requests; daemon polls and fulfills them.
   */
  chatroom_workspaceFileContentRequests: defineTable({
    machineId: v.string(),
    workingDir: v.string(),
    filePath: v.string(),

    status: v.union(
      v.literal('pending'),
      v.literal('processing'),
      v.literal('done'),
      v.literal('error')
    ),
    requestedAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_machine_status', ['machineId', 'status'])
    .index('by_machine_workingDir_path', ['machineId', 'workingDir', 'filePath']),

  /**
   * On-demand file tree scan requests.
   * Frontend requests a fresh tree scan; daemon fulfills by scanning and calling syncFileTree.
   */
  chatroom_workspaceFileTreeRequests: defineTable({
    machineId: v.string(),
    workingDir: v.string(),
    status: v.string(), // 'pending' | 'done'
    requestedAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_machine_status', ['machineId', 'status'])
    .index('by_machine_workingDir', ['machineId', 'workingDir']),

  // ─── Structured Workflows ────────────────────────────────────────────────────
  // DAG-based workflows that agents create and execute step-by-step.
  // Workflows block user handoff until completed or explicitly exited.

  /** Workflow definitions — one per workflowKey per chatroom. */
  chatroom_workflows: defineTable({
    chatroomId: v.id('chatroom_rooms'),
    workflowKey: v.string(), // User-provided unique key within chatroom
    status: v.union(
      v.literal('draft'), // Created but not yet started
      v.literal('active'), // In progress — steps are being executed
      v.literal('completed'), // All steps completed or cancelled
      v.literal('cancelled') // Manually exited early
    ),
    createdBy: v.string(), // Role that created the workflow
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
  })
    .index('by_chatroom', ['chatroomId'])
    .index('by_chatroom_workflowKey', ['chatroomId', 'workflowKey'])
    .index('by_chatroom_status', ['chatroomId', 'status']),

  /** Steps within a workflow — nodes of the DAG. */
  chatroom_workflow_steps: defineTable({
    chatroomId: v.id('chatroom_rooms'),
    workflowId: v.id('chatroom_workflows'),
    stepKey: v.string(), // User-provided unique key within workflow
    description: v.string(), // Short plain text description
    status: v.union(
      v.literal('pending'), // Waiting for dependencies
      v.literal('in_progress'), // Dependencies met, work in progress
      v.literal('completed'), // Step finished successfully
      v.literal('cancelled') // Step cancelled
    ),
    assigneeRole: v.optional(v.string()), // Role assigned to this step
    dependsOn: v.array(v.string()), // stepKeys this step depends on (DAG edges)
    order: v.number(), // Display order
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
    specification: v.optional(
      v.object({
        goal: v.string(),
        requirements: v.string(),
        warnings: v.optional(v.string()),
        skills: v.optional(v.string()),
      })
    ),
  })
    .index('by_workflow', ['workflowId'])
    .index('by_workflow_stepKey', ['workflowId', 'stepKey'])
    .index('by_chatroom', ['chatroomId']),

  /** Chat platform integrations (e.g. Telegram, Slack) linked to a chatroom. */
  chatroom_integrations: defineTable({
    chatroomId: v.id('chatroom_rooms'),
    /** Platform identifier (e.g. "telegram", "slack") */
    platform: v.string(),
    /** Platform-specific configuration (bot token, chat ID, etc.) */
    config: v.object({
      /** Bot token or API key — sensitive, stored encrypted at rest by Convex */
      botToken: v.optional(v.string()),
      /** Platform-specific chat/channel ID to bridge */
      chatId: v.optional(v.string()),
      /** Optional webhook URL */
      webhookUrl: v.optional(v.string()),
      /** Webhook secret for verifying inbound requests from Telegram */
      webhookSecret: v.optional(v.string()),
    }),
    /** Whether the integration is currently active */
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_chatroom', ['chatroomId'])
    .index('by_chatroom_platform', ['chatroomId', 'platform']),

  // ─── Command Runner ─────────────────────────────────────────────────────────
  // Synced commands discovered from package.json scripts and turbo.json tasks.

  /**
   * Available commands discovered from workspace package.json/turbo.json.
   * Synced by the daemon during heartbeat.
   */
  chatroom_runnableCommands: defineTable({
    machineId: v.string(),
    workingDir: v.string(),
    name: v.string(),
    script: v.string(),
    source: v.union(v.literal('package.json'), v.literal('turbo.json')),
    /** Relative workspace path (e.g., '.', 'apps/webapp', 'packages/cli') @deprecated Use subWorkspace instead */
    workspace: v.optional(v.string()),
    /** Relative sub-workspace path within the monorepo (e.g., '.', 'apps/webapp', 'packages/cli') */
    subWorkspace: v.optional(v.object({
      /** Ecosystem type (e.g., "npm", "cargo", "go") */
      type: v.string(),
      /** Relative path from workspace root to the sub-package directory */
      path: v.string(),
      /** Package name from package manager (e.g., "@workspace/webapp") */
      name: v.string(),
    })),
    syncedAt: v.number(),
  })
    .index('by_machine_workingDir', ['machineId', 'workingDir']),

  /**
   * Command execution runs. Tracks lifecycle of a spawned command process.
   */
  chatroom_commandRuns: defineTable({
    machineId: v.string(),
    workingDir: v.string(),
    commandName: v.string(),
    script: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('stopped')
    ),
    pid: v.optional(v.number()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    exitCode: v.optional(v.number()),
    requestedBy: v.id('users'),
  })
    .index('by_machine_workingDir', ['machineId', 'workingDir'])
    .index('by_machine_workingDir_status', ['machineId', 'workingDir', 'status'])
    .index('by_status', ['status']),

  /**
   * Buffered output chunks for command runs.
   * Daemon flushes accumulated stdout/stderr every few seconds to limit DB writes.
   */
  chatroom_commandOutput: defineTable({
    runId: v.id('chatroom_commandRuns'),
    content: v.string(),
    chunkIndex: v.number(),
    timestamp: v.number(),
  })
    .index('by_runId_chunkIndex', ['runId', 'chunkIndex']),
});
