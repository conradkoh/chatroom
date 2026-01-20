import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

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
  }).index('by_sessionId', ['sessionId']),

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
    status: v.union(v.literal('active'), v.literal('interrupted'), v.literal('completed')),
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
  })
    .index('by_status', ['status'])
    .index('by_ownerId', ['ownerId'])
    .index('by_ownerId_lastActivity', ['ownerId', 'lastActivityAt']),

  /**
   * Participants in chatrooms.
   * Tracks which agents/users have joined and their current status.
   */
  chatroom_participants: defineTable({
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    status: v.union(v.literal('idle'), v.literal('active'), v.literal('waiting')),
    // Timestamp when this participant's readiness (waiting status) expires
    // After this time, a waiting participant is considered disconnected/stale
    // Used when status = 'waiting'
    readyUntil: v.optional(v.number()),
    // Timestamp when this participant's active work session expires
    // After this time, an active participant is considered crashed/stale
    // Used when status = 'active' (typically ~1 hour to allow for long tasks)
    activeUntil: v.optional(v.number()),
  })
    .index('by_chatroom', ['chatroomId'])
    .index('by_chatroom_and_role', ['chatroomId', 'role']),

  /**
   * Messages in chatrooms.
   * Supports targeted messages, broadcasts, handoffs, and interrupts.
   */
  chatroom_messages: defineTable({
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    content: v.string(),
    targetRole: v.optional(v.string()),
    // For broadcast messages, this gets set when the message is claimed
    claimedByRole: v.optional(v.string()),
    type: v.union(
      v.literal('message'),
      v.literal('handoff'),
      v.literal('interrupt'),
      v.literal('join')
    ),
    // Classification of user messages (set via task-started command)
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
    // Set when an agent runs task-started, links all related messages
    taskOriginMessageId: v.optional(v.id('chatroom_messages')),
    // Link to the task created for this message (for user messages)
    // Used to track processing status in the UI
    taskId: v.optional(v.id('chatroom_tasks')),

    // Attached backlog tasks for context
    // User can attach multiple backlog tasks to a message for agent context
    // When agent runs task-started, all attached tasks with backlog.status = 'not_started' become 'started'
    attachedTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),

    // Message lifecycle tracking
    // acknowledgedAt: When an agent received and started working on this message
    acknowledgedAt: v.optional(v.number()),
    // completedAt: When the agent completed work on this message (via handoff)
    completedAt: v.optional(v.number()),
  })
    .index('by_chatroom', ['chatroomId'])
    .index('by_taskId', ['taskId'])
    // Index for efficient origin message lookup (non-follow-up user messages)
    // Fields ordered: chatroomId (always filtered) → senderRole ('user') → type ('message') → _creationTime (ordering)
    .index('by_chatroom_senderRole_type_createdAt', ['chatroomId', 'senderRole', 'type']),

  /**
   * Tasks in chatrooms for queue and backlog management.
   * Tracks task lifecycle from creation through completion.
   * Only one task can be pending or in_progress at a time per chatroom.
   */
  chatroom_tasks: defineTable({
    chatroomId: v.id('chatroom_rooms'),
    createdBy: v.string(), // 'user' or role name that created the task

    // Content (plain text only)
    content: v.string(),

    // Status tracking
    status: v.union(
      v.literal('pending'), // Ready for agent, awaiting task-started
      v.literal('in_progress'), // Agent actively working on it
      v.literal('queued'), // Waiting in line (hidden from agent)
      v.literal('backlog'), // User-created future task (not auto-picked)
      v.literal('completed'), // Finished
      v.literal('cancelled') // Cancelled by user
    ),

    // Assignment
    assignedTo: v.optional(v.string()), // Role assigned to work on this

    // Link to source message (for auto-created tasks from user messages)
    sourceMessageId: v.optional(v.id('chatroom_messages')),

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()), // When task-started was called
    completedAt: v.optional(v.number()), // When task-complete was called

    // Queue ordering (lower = earlier in queue)
    queuePosition: v.number(),

    // Backlog lifecycle tracking (only for tasks that originated as backlog items)
    // Enables tracking backlog item completion independently of task queue status
    backlog: v.optional(
      v.object({
        status: v.union(
          v.literal('not_started'), // Default - task is in backlog, work has not begun
          v.literal('started'), // Task has been moved to queue at least once
          v.literal('complete'), // User has confirmed the issue is resolved
          v.literal('closed') // User has closed the task without completing
        ),
      })
    ),
  })
    .index('by_chatroom', ['chatroomId'])
    .index('by_chatroom_status', ['chatroomId', 'status'])
    .index('by_chatroom_queue', ['chatroomId', 'queuePosition']),

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
});
