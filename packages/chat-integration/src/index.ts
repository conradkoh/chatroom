/**
 * @workspace/chat-integration
 *
 * Bridges external chat platforms (Telegram, Slack, etc.) to chatroom
 * using the Chat SDK (https://chat-sdk.dev).
 */

// Types
export type {
  BridgeConfig,
  ChatroomBridge,
  ChatroomMessage,
  PlatformMessage,
  PlatformMessageHandler,
} from './types.js';

// Forwarder
export type { ChatroomForwarder, ForwarderContext, ForwardFn } from './forwarder.js';
export { createCallbackForwarder, noopForwarder } from './forwarder.js';

// Message mapping
export { toPlatformMessage, stripMarkdown, prepareChatroomText } from './mapping.js';

// Telegram
export { createTelegramBridge, type TelegramBridgeConfig } from './telegram/index.js';
