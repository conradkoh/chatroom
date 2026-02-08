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
    status: v.union(
      v.literal('active'),
      v.literal('waiting'),
      // @deprecated - idle status is no longer used. Kept for migration compatibility
      // with existing documents. Will be removed after data cleanup.
      v.literal('idle')
    ),
    // Timestamp when this participant's readiness (waiting status) expires
    // After this time, a waiting participant is considered disconnected/stale
    // Used when status = 'waiting'
    readyUntil: v.optional(v.number()),
    // Timestamp when this participant's active work session expires
    // After this time, an active participant is considered crashed/stale
    // Used when status = 'active' (typically ~1 hour to allow for long tasks)
    activeUntil: v.optional(v.number()),
    // Unique connection ID for the current wait-for-task session
    // Used to detect concurrent wait-for-task processes and terminate old ones
    // When a new wait-for-task starts, it generates a new connectionId
    // The old process detects the mismatch and exits cleanly
    connectionId: v.optional(v.string()),
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
    type: v.union(
      v.literal('message'),
      v.literal('handoff'),
      v.literal('join'),
      v.literal('progress')
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
    // Attached tasks remain in 'backlog' status until agent hands off to user,
    // at which point they transition to 'pending_user_review'
    attachedTaskIds: v.optional(v.array(v.id('chatroom_tasks'))),

    // Attached artifacts for context
    // Agents can attach multiple artifacts to handoffs for reference
    attachedArtifactIds: v.optional(v.array(v.id('chatroom_artifacts'))),

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
   *
   * Task workflows are determined by origin:
   * - backlog: backlog → queued → pending → in_progress → pending_user_review → completed/closed
   * - chat: queued → pending → in_progress → completed
   */
  chatroom_tasks: defineTable({
    chatroomId: v.id('chatroom_rooms'),
    createdBy: v.string(), // 'user' or role name that created the task

    // Content (plain text only)
    content: v.string(),

    // Origin - where this task came from (immutable after creation)
    // Determines which workflow/state machine applies to this task
    origin: v.optional(
      v.union(
        v.literal('backlog'), // Created in backlog tab
        v.literal('chat') // Created from chat message
      )
    ),

    // Status tracking
    // Note: available statuses depend on origin (see workflows above)
    status: v.union(
      v.literal('backlog'), // Backlog origin: initial state, task is in backlog tab
      v.literal('queued'), // Waiting in line (hidden from agent)
      v.literal('pending'), // Ready for agent to pick up
      v.literal('acknowledged'), // Agent claimed task via wait-for-task, not yet started
      v.literal('in_progress'), // Agent actively working on it
      v.literal('backlog_acknowledged'), // Backlog task attached to message, visible to agent
      v.literal('pending_user_review'), // Backlog only: agent done, user must confirm
      v.literal('completed'), // Finished successfully
      v.literal('closed') // Backlog only: user closed without completing
    ),

    // Assignment
    assignedTo: v.optional(v.string()), // Role assigned to work on this

    // Link to source message (for auto-created tasks from user messages)
    sourceMessageId: v.optional(v.id('chatroom_messages')),

    // Backlog attachment tracking (bidirectional)
    attachedTaskIds: v.optional(v.array(v.id('chatroom_tasks'))), // Backlog tasks attached to this task
    parentTaskIds: v.optional(v.array(v.id('chatroom_tasks'))), // Tasks this backlog item is attached to

    // Timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
    acknowledgedAt: v.optional(v.number()), // When agent claimed task via wait-for-task
    startedAt: v.optional(v.number()), // When task-started was called
    completedAt: v.optional(v.number()), // When task-complete was called

    // Queue ordering (lower = earlier in queue)
    queuePosition: v.number(),

    // Scoring fields for backlog prioritization (set by agents or users)
    // Complexity: low = easy to implement, high = complex/risky
    complexity: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
    // Value: low = nice-to-have, high = critical/high-impact
    value: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
    // Priority: numeric priority for flexible ordering (higher = more important)
    // Used as primary sort key for backlog tasks
    priority: v.optional(v.number()),
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
    // Operating system (darwin, linux, win32)
    os: v.string(),
    // Available agent harnesses on this machine
    availableHarnesses: v.optional(v.array(v.literal('opencode'))),
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
    // @deprecated - use availableHarnesses instead (kept for migration compatibility)
    availableTools: v.optional(v.array(v.literal('opencode'))),
    // @deprecated - use harnessVersions instead (kept for migration compatibility)
    toolVersions: v.optional(
      v.record(
        v.string(),
        v.object({
          version: v.string(),
          major: v.number(),
        })
      )
    ),
    // Available AI models discovered via `opencode models` (dynamic, per-machine)
    availableModels: v.optional(v.array(v.string())),
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
   * Agent configurations per machine, chatroom, and role.
   * Stores context needed to restart agents remotely.
   */
  chatroom_machineAgentConfigs: defineTable({
    // Reference to machine (machineId string, not Convex ID)
    machineId: v.string(),
    // Chatroom this config is for
    chatroomId: v.id('chatroom_rooms'),
    // Role this config is for
    role: v.string(),
    // Agent harness used (must be in machine's availableHarnesses)
    agentType: v.literal('opencode'),
    // Working directory on the machine
    workingDir: v.string(),
    // AI model to use (e.g. "github-copilot/claude-sonnet-4.5")
    model: v.optional(v.string()),
    // Last updated timestamp
    updatedAt: v.number(),
    // PID of spawned agent (for stop functionality), null if not running
    spawnedAgentPid: v.optional(v.number()),
    // When the agent was spawned (for tracking)
    spawnedAt: v.optional(v.number()),
  })
    .index('by_machine_chatroom_role', ['machineId', 'chatroomId', 'role'])
    .index('by_chatroom', ['chatroomId']),

  /**
   * Commands sent to machines for remote execution.
   * Daemon subscribes to pending commands and processes them.
   */
  chatroom_machineCommands: defineTable({
    // Target machine ID
    machineId: v.string(),
    // Command type
    type: v.union(
      v.literal('start-agent'),
      v.literal('stop-agent'),
      v.literal('ping'),
      v.literal('status')
    ),
    // Command payload (varies by type)
    payload: v.object({
      chatroomId: v.optional(v.id('chatroom_rooms')),
      role: v.optional(v.string()),
      agentHarness: v.optional(v.literal('opencode')),
      // @deprecated - use agentHarness instead (kept for migration compatibility)
      agentTool: v.optional(v.literal('opencode')),
      // AI model to use when starting agent (e.g. "github-copilot/claude-sonnet-4.5")
      model: v.optional(v.string()),
      // Working directory for the agent (absolute path on the remote machine)
      workingDir: v.optional(v.string()),
    }),
    // Command status
    status: v.union(
      v.literal('pending'),
      v.literal('processing'),
      v.literal('completed'),
      v.literal('failed')
    ),
    // Result or error message
    result: v.optional(v.string()),
    // Who sent the command (must own the machine)
    sentBy: v.id('users'),
    // Timestamps
    createdAt: v.number(),
    processedAt: v.optional(v.number()),
  }).index('by_machineId_status', ['machineId', 'status']),

  /**
   * Agent start preferences per chatroom.
   * Updated each time a user starts a remote agent from the UI.
   * Used to improve default selections for machine, harness, and model.
   */
  chatroom_agentPreferences: defineTable({
    // Chatroom this preference belongs to
    chatroomId: v.id('chatroom_rooms'),
    // User who set the preference
    userId: v.id('users'),
    // Last selected machine ID
    machineId: v.optional(v.string()),
    // Last selected agent harness per role (e.g. { "builder": "opencode" })
    harnessByRole: v.optional(v.record(v.string(), v.string())),
    // @deprecated - use harnessByRole instead (kept for migration compatibility)
    toolByRole: v.optional(v.record(v.string(), v.string())),
    // Last selected model per role (e.g. { "builder": "github-copilot/claude-sonnet-4.5" })
    modelByRole: v.optional(v.record(v.string(), v.string())),
    // Last updated timestamp
    updatedAt: v.number(),
  }).index('by_chatroom_user', ['chatroomId', 'userId']),
});
