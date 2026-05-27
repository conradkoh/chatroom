/** Supported chat platforms */
export type Platform = 'telegram' | 'slack' | 'whatsapp';

/** Author information from an external platform */
export interface PlatformAuthor {
  id: string;
  name: string;
  username?: string;
}

/** Base message structure from external platforms */
export interface PlatformMessage {
  id: string;
  text: string;
  threadId: string;
  author: PlatformAuthor;
  timestamp: string;
  platform: Platform;
}
