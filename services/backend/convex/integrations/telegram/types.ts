/**
 * Telegram-specific types for the Telegram integration.
 */

/** Subset of a Telegram Update object (message updates only). */
export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
      title?: string;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
    date: number;
    text?: string;
  };
}

/** Subset of Telegram's User object returned by getMe. */
export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

/** Telegram getMe API response. */
export interface GetMeResponse {
  ok: boolean;
  result?: TelegramBotInfo;
  description?: string;
}

/** Telegram setWebhook / deleteWebhook API response. */
export interface WebhookResponse {
  ok: boolean;
  result?: boolean;
  description?: string;
}
