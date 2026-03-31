/**
 * Telegram bridge — connects a Telegram bot (via Chat SDK) to chatroom.
 *
 * Uses the `chat` core package with `@chat-adapter/telegram` and
 * `@chat-adapter/state-memory` for local development state.
 */

import { Chat } from 'chat';
import { createTelegramAdapter, type TelegramAdapterConfig } from '@chat-adapter/telegram';
import { createMemoryState } from '@chat-adapter/state-memory';

import type {
  BridgeConfig,
  ChatroomBridge,
  ChatroomMessage,
  PlatformMessage,
  PlatformMessageHandler,
} from '../types.js';
import type { ChatroomForwarder, ForwarderContext } from '../forwarder.js';
import { noopForwarder } from '../forwarder.js';
import { toPlatformMessage } from '../mapping.js';

// ─── Config ────────────────────────────────────────────────────────────────────

export interface TelegramBridgeConfig extends BridgeConfig {
  /** Telegram bot token from BotFather. Falls back to TELEGRAM_BOT_TOKEN env var. */
  botToken?: string;

  /**
   * Adapter runtime mode.
   * - "polling" — long-polling (good for local dev, no public URL needed)
   * - "webhook" — webhook mode (production)
   * - "auto"    — let the adapter decide (default)
   */
  mode?: 'auto' | 'webhook' | 'polling';

  /**
   * Optional forwarder for sending platform messages to the chatroom backend.
   * If not provided, messages are only dispatched to `onPlatformMessage` handlers.
   */
  forwarder?: ChatroomForwarder;

  /** Chatroom ID for the forwarder context. Required if forwarder is provided. */
  chatroomId?: string;
}

// ─── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a ChatroomBridge backed by a Telegram bot.
 *
 * @example
 * ```ts
 * const bridge = createTelegramBridge({
 *   userName: 'my-chatroom-bot',
 *   botToken: process.env.TELEGRAM_BOT_TOKEN,
 *   mode: 'polling',
 * });
 *
 * bridge.onPlatformMessage(async (msg) => {
 *   console.log('Received from Telegram:', msg.text);
 * });
 *
 * await bridge.start();
 * ```
 */
export function createTelegramBridge(config: TelegramBridgeConfig): ChatroomBridge {
  const handlers: PlatformMessageHandler[] = [];
  const forwarder = config.forwarder ?? noopForwarder;
  const forwarderCtx: ForwarderContext = {
    chatroomId: config.chatroomId ?? '',
    platform: 'telegram',
  };

  const adapterConfig: TelegramAdapterConfig = {
    botToken: config.botToken,
    mode: config.mode ?? 'auto',
  };

  const telegram = createTelegramAdapter(adapterConfig);
  const state = createMemoryState();

  const adapters = { telegram } as const;

  const chat = new Chat({
    userName: config.userName,
    adapters,
    state,
  });

  // ── Inbound: Platform → Chatroom ──────────────────────────────────────────

  /** Dispatch a platform message to all registered handlers and the forwarder. */
  const dispatch = async (msg: PlatformMessage) => {
    // Fire registered handlers
    for (const handler of handlers) {
      await handler(msg);
    }
    // Forward to chatroom backend
    await forwarder.forward(msg, forwarderCtx);
  };

  // Handle first-time mentions (unsubscribed threads)
  chat.onNewMention(async (thread, message) => {
    // Subscribe so future messages in this thread also reach us
    await thread.subscribe();
    await dispatch(toPlatformMessage(thread.id, message, 'telegram'));
  });

  // Handle direct messages
  chat.onDirectMessage(async (thread, message) => {
    await thread.subscribe();
    await dispatch(toPlatformMessage(thread.id, message, 'telegram'));
  });

  // Handle follow-up messages in subscribed threads
  chat.onSubscribedMessage(async (thread, message) => {
    await dispatch(toPlatformMessage(thread.id, message, 'telegram'));
  });

  // ── Bridge implementation ─────────────────────────────────────────────────

  const bridge: ChatroomBridge = {
    async start() {
      await chat.initialize();
    },

    async stop() {
      await chat.shutdown();
    },

    async onChatroomMessage(message: ChatroomMessage) {
      // Register singleton so ChannelImpl can resolve the adapter
      chat.registerSingleton();

      // In Telegram, threadId maps to a chat/channel. Use the channel
      // abstraction to post the outbound message.
      const channel = chat.channel(message.threadId);
      await channel.post(message.text);
    },

    onPlatformMessage(handler: PlatformMessageHandler) {
      handlers.push(handler);
    },
  };

  return bridge;
}
