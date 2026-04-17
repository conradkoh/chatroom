import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/** Canonical harness validator — add new harnesses here. */
export const agentHarnessValidator = v.union(
  v.literal('opencode'),
  v.literal('pi'),
  v.literal('cursor'),
  v.literal('claude'),
  v.literal('copilot')
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
  }).index('by_chatroom', ['chatroomId']),

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
  /**
   * Chatroom custom prompts — discriminated union for future extensibility.
   * Currently supports `development_workflow` type only.
   */
  chatroom_prompts: defineTable(
    v.union(
      v.object({
        type: v.literal('development_workflow'),
        chatroomId: v.id('chatroom_rooms'),
        ownerId: v.id('users'),
        name: v.string(),
        content: v.string(),
        isEnabled: v.boolean(),
        sourceChatroomId: v.optional(v.id('chatroom_rooms')),
        sourcePromptId: v.optional(v.id('chatroom_prompts')),
        createdAt: v.number(),
        updatedAt: v.number(),
      })
    )
  )
    .index('by_chatroomId', ['chatroomId'])
    .index('by_chatroomId_type', ['chatroomId', 'type'])
    .index('by_sourcePromptId', ['sourcePromptId']),
});

