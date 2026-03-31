# @workspace/chat-integration

Bridge layer between external chat platforms and chatroom, built on the [Chat SDK](https://chat-sdk.dev).

## Status: Not Currently Wired Up

> **Note:** This package was designed for **standalone Node.js deployments** (Option A). The chatroom app currently uses **Convex HTTP actions** (Option B) for the Telegram integration instead, implemented directly in `services/backend/convex/telegramBot.ts`.
>
> This package is kept as a future alternative for non-Convex deployments or for connecting platforms outside of the Convex runtime.

## What's Here

- **`ChatroomBridge`** interface — clean abstraction for bi-directional message forwarding
- **`createTelegramBridge()`** — factory using Chat SDK + `@chat-adapter/telegram`
- **`ChatroomForwarder`** — pluggable transport for delivering messages to the backend
- **Message mapping** — `toPlatformMessage()`, `stripMarkdown()` utilities
- **18 tests** — covering mapping, stripping, and forwarder logic

## Usage (Future)

```ts
import { createTelegramBridge } from '@workspace/chat-integration';

const bridge = createTelegramBridge({
  userName: 'my-bot',
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  mode: 'polling',
});

bridge.onPlatformMessage(async (msg) => {
  // Forward to chatroom backend
});

await bridge.start();
```
