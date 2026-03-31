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

  /** Dispatch a platform message to all registered handlers. */
  const dispatch = async (msg: PlatformMessage) => {
    for (const handler of handlers) {
      await handler(msg);
    }
  };

  /** Convert a Chat SDK message into our PlatformMessage shape. */
  const toPlatformMessage = (threadId: string, message: import('chat').Message): PlatformMessage => ({
    id: message.id,
    text: message.text ?? '',
    threadId,
    author: {
      id: message.author?.userId ?? 'unknown',
      name: message.author?.fullName ?? message.author?.userName ?? 'unknown',
    },
    timestamp: message.metadata?.dateSent?.toISOString() ?? new Date().toISOString(),
    platform: 'telegram',
  });

  // Handle first-time mentions (unsubscribed threads)
  chat.onNewMention(async (thread, message) => {
    // Subscribe so future messages in this thread also reach us
    await thread.subscribe();
    await dispatch(toPlatformMessage(thread.id, message));
  });

  // Handle direct messages
  chat.onDirectMessage(async (thread, message) => {
    await thread.subscribe();
    await dispatch(toPlatformMessage(thread.id, message));
  });

  // Handle follow-up messages in subscribed threads
  chat.onSubscribedMessage(async (thread, message) => {
    await dispatch(toPlatformMessage(thread.id, message));
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
