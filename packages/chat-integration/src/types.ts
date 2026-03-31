/**
 * ChatroomBridge — abstraction layer between Chat SDK platforms and chatroom.
 *
 * A bridge instance manages the lifecycle of a Chat SDK bot connection and
 * provides a clean interface for bi-directional message forwarding:
 *   - Platform → Chatroom: via the `onPlatformMessage` callback
 *   - Chatroom → Platform: via `onChatroomMessage()`
 */

// ─── Inbound (Platform → Chatroom) ────────────────────────────────────────────

/** A message received from an external chat platform (e.g. Telegram). */
export interface PlatformMessage {
  /** Unique message ID from the platform */
  id: string;
  /** Plain-text content of the message */
  text: string;
  /** Platform-specific thread/conversation ID */
  threadId: string;
  /** Author information */
  author: {
    id: string;
    name: string;
  };
  /** ISO-8601 timestamp */
  timestamp: string;
  /** The adapter/platform name (e.g. "telegram") */
  platform: string;
}

/** Callback invoked when a message arrives from the external platform. */
export type PlatformMessageHandler = (message: PlatformMessage) => void | Promise<void>;

// ─── Outbound (Chatroom → Platform) ───────────────────────────────────────────

/** A chatroom message to be forwarded to the external platform. */
export interface ChatroomMessage {
  /** Plain-text content to send */
  text: string;
  /** Platform-specific thread/conversation ID to send to */
  threadId: string;
}

// ─── Bridge Interface ─────────────────────────────────────────────────────────

/** Configuration shared by all bridge implementations. */
export interface BridgeConfig {
  /** Human-readable bot user name used by Chat SDK */
  userName: string;
}

/**
 * A ChatroomBridge connects an external chat platform to chatroom.
 *
 * Lifecycle:
 *   1. Create with a factory (e.g. `createTelegramBridge(config)`)
 *   2. Register a platform message handler via `onPlatformMessage(handler)`
 *   3. Call `start()` to begin listening
 *   4. Forward chatroom messages via `onChatroomMessage(message)`
 *   5. Call `stop()` to gracefully shut down
 */
export interface ChatroomBridge {
  /** Start the bot / open the connection. */
  start(): Promise<void>;

  /** Gracefully shut down the bot / close the connection. */
  stop(): Promise<void>;

  /**
   * Forward a chatroom message to the external platform.
   * The bridge is responsible for delivering it to the correct thread.
   */
  onChatroomMessage(message: ChatroomMessage): Promise<void>;

  /**
   * Register a callback that fires when a message arrives from the platform.
   * Must be called before `start()`.
   */
  onPlatformMessage(handler: PlatformMessageHandler): void;
}
