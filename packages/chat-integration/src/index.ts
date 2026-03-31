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

// Telegram
export { createTelegramBridge, type TelegramBridgeConfig } from './telegram/index.js';
