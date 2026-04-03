/**
 * Telegram-specific types for the Telegram integration.
 */

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
