# Feature: `chatroom messages` CLI reference

**Status:** Implemented
**Last Updated:** 2026-11-26

---

## Overview

The `messages` command group reads chatroom history by **page** and sends user
messages. A page is a user message plus every timeline message up to the next
user message; its id is the user message's id. The domain model is defined in
[message-domain-and-pages.md](./message-domain-and-pages.md).

The commands are implemented in `packages/cli/src/commands/messages/` and
registered in `packages/cli/src/index.ts`.

## 1. Command tree

```
Usage: chatroom messages [options] [command]

Read chatroom history by page, and send user messages

Options:
  -h, --help          display help for command

Commands:
  pages [options]     List pages: each starts at a user message and runs until
                      the next user message
  download [options]  Download the selected page(s) as files for reading and
                      grep
  send [options]      Send a user message to a chatroom
  help [command]      display help for command
```

### `pages`

```
Usage: chatroom messages pages [options]

List pages: each starts at a user message and runs until the next user message

Options:
  --chatroom-id <id>     Chatroom identifier
  --role <role>          Your role
  --page-id <messageId>  Page to start from, identified by its start (user)
                         message id (default: latest page)
  --before <n>           Also include n pages before the selected page (default:
                         9, max 50)
  --after <n>            Also include n pages after the selected page (default:
                         0, max 50)
  -h, --help             display help for command
```

### `download`

```
Usage: chatroom messages download [options]

Download the selected page(s) as files for reading and grep

Options:
  --chatroom-id <id>     Chatroom identifier
  --role <role>          Your role
  --max-messages <n>     Stop after n messages (default: 500, max: 5000)
  --output-dir <path>    Output directory (default:
                         .chatroom/downloads/messages/<download-id>)
  --page-id <messageId>  Page to start from, identified by its start (user)
                         message id (default: latest page)
  --before <n>           Also include n pages before the selected page (default:
                         0, max 50)
  --after <n>            Also include n pages after the selected page (default:
                         0, max 50)
  -h, --help             display help for command
```

### `send`

```
Usage: chatroom messages send [options]

Send a user message to a chatroom

Options:
  --chatroom-id <id>    Chatroom identifier
  --content <text>      Message content
  --target-role <role>  Target role (defaults to team entry point)
  -h, --help            display help for command
```

## 2. Flag reference

| Flag             | Command                     | Default                                                                    | Max    |
| ---------------- | --------------------------- | -------------------------------------------------------------------------- | ------ |
| `--chatroom-id`  | `pages`, `download`, `send` | required                                                                   | —      |
| `--role`         | `pages`, `download`         | required                                                                   | —      |
| `--page-id`      | `pages`, `download`         | latest page                                                                | —      |
| `--before`       | `pages`                     | `9`                                                                        | `50`   |
| `--after`        | `pages`                     | `0`                                                                        | `50`   |
| `--before`       | `download`                  | `0`                                                                        | `50`   |
| `--after`        | `download`                  | `0`                                                                        | `50`   |
| `--max-messages` | `download`                  | `500`                                                                      | `5000` |
| `--output-dir`   | `download`                  | `.chatroom/downloads/messages/<download-id>` (under the current directory) | —      |
| `--content`      | `send`                      | required                                                                   | —      |
| `--target-role`  | `send`                      | the chatroom's team entry point                                            | —      |

`--before` and `--after` must be integers in `0..50`. Other values exit 1 with a
validation line naming the flag. `download --max-messages` must be a positive
integer; values above `5000` clamp to `5000`.

## 3. `pages` output contract

The output is stable; tests assert it.

```
📄 Pages in chatroom <id> (<n> shown)
  <pageId>  <ISO startedAt>  <preview, whitespace collapsed, ≤120 chars>  [latest]  [selected]
  ...
prev page: <pageId|none>   next page: <pageId|none>

💡 Download the latest page:  chatroom messages download --chatroom-id=<id> --role=<role>
💡 Download an older page:    chatroom messages download --chatroom-id=<id> --role=<role> --page-id=<pageId> [--before=<n>] [--after=<n>]
```

- Rows are ascending by page start; the last row is the newest page in the
  window.
- `[latest]` marks the open latest page (`endExclusive === null`).
- `[selected]` marks the page the window was resolved from.
- `prev page` / `next page` are the pages immediately outside the window.
  They are `none` at the oldest/latest boundary and when the window already
  covers every page (`pages --before=9` on a short chatroom).
- The preview is the start message content with whitespace collapsed and
  trimmed, capped at 120 characters by the backend.
- An empty chatroom prints `📭 No pages: this chatroom has no user messages yet.`
  and exits 0.

## 4. `download` manifest

One file per message is written with `messageFilename`, whose prefix is
`SORT_KEY_MAX - _creationTime` padded to 13 digits (descending creation time),
followed by `<senderRole>-to-<targetRole|all>_<messageId>.md`. The content is the
`linear` serialization profile.

`manifest.json` has these keys:

| Key                  | Meaning                                                   |
| -------------------- | --------------------------------------------------------- |
| `chatroomId`         | The chatroom.                                             |
| `downloadedAt`       | ISO timestamp of the download.                            |
| `format`             | Always `"linear"`.                                        |
| `selection`          | `{ pageId: string \| null, before, after }` as requested. |
| `pages`              | Per-page summaries (below).                               |
| `prevPageId`         | Page before the window, or `null`.                        |
| `nextPageId`         | Page after the window, or `null`.                         |
| `count`              | Messages written.                                         |
| `complete`           | `!truncated`.                                             |
| `truncated`          | `true` when `--max-messages` stopped the download early.  |
| `oldestDownloadedAt` | ISO timestamp of the oldest message, or `null`.           |
| `newestDownloadedAt` | ISO timestamp of the newest message, or `null`.           |
| `messages`           | Per-message entries (below).                              |

Each `pages[]` entry:

| Key            | Meaning                                                              |
| -------------- | -------------------------------------------------------------------- |
| `pageId`       | Start message id.                                                    |
| `startedAt`    | ISO timestamp of the start message.                                  |
| `endExclusive` | ISO timestamp of the next start, or `null` for the open latest page. |
| `messageCount` | Messages written from this page.                                     |
| `complete`     | `true` when the page was read to its end (or its open guard).        |

Each `messages[]` entry:

| Key           | Meaning                             |
| ------------- | ----------------------------------- |
| `id`          | Message id.                         |
| `file`        | File name in the output directory.  |
| `createdAt`   | ISO timestamp.                      |
| `pageId`      | Page the message belongs to.        |
| `senderRole`  | Sender role.                        |
| `targetRole`  | Target role, or `null`.             |
| `senderAgent` | Handoff sender snapshot, or absent. |

## 5. Old → new command map

| Removed                                      | Replacement                                                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `messages anchor`                            | `messages pages` (index with ids and previews), then `messages download` (latest page)         |
| `messages list --sender-role=user --limit=N` | `messages pages --before=<N-1>`                                                                |
| `messages list --since-message-id=X`         | `messages download --page-id=X --after=<n>` (X must be a page start)                           |
| `messages download --limit=N` (newest N)     | `messages download --before=<k>` (latest page plus k earlier pages); cap with `--max-messages` |
| `messages download --since-message-id=X`     | `messages download --page-id=X`                                                                |
| `messages download --format=linear`          | no flag (`format` is recorded in the manifest)                                                 |
| `chatroom message send`                      | `chatroom messages send`                                                                       |

## 6. Worked examples

These use the local end-to-end seed chatroom `px73v73m3yty1v3m4fp3xmxr398jzp3h`
with three user messages, each followed by a handoff to the user. The page
starts are:

- `pd78c5absmbne6yq9c01hcrm9s8jy362` — "First user request about alpha"
- `pd77f19khak9dm0eq4ng3bkyds8jzmrq` — "Second user request about beta"
- `pd724ad0x94pnjwd67f3h96bx18jzzwx` — "Third user request about gamma" (latest)

### Latest page only

```bash
chatroom messages download --chatroom-id=px73v73m3yty1v3m4fp3xmxr398jzp3h --role=solo
```

Writes 2 messages (the third user message and its handoff), from 1 page:

```json
{
  "pages": [
    {
      "pageId": "pd724ad0x94pnjwd67f3h96bx18jzzwx",
      "startedAt": "2026-11-26T09:18:43.821Z",
      "endExclusive": null,
      "messageCount": 2,
      "complete": true
    }
  ],
  "count": 2,
  "complete": true,
  "truncated": false,
  "prevPageId": "pd77f19khak9dm0eq4ng3bkyds8jzmrq",
  "nextPageId": null
}
```

### One earlier page

```bash
chatroom messages download --chatroom-id=px73v73m3yty1v3m4fp3xmxr398jzp3h --role=solo --before=1
```

Writes 4 messages from pages 2 and 3, ascending:

```json
{
  "pages": [
    {
      "pageId": "pd77f19khak9dm0eq4ng3bkyds8jzmrq",
      "startedAt": "2026-11-26T09:18:42.167Z",
      "endExclusive": "2026-11-26T09:18:43.821Z",
      "messageCount": 2,
      "complete": true
    },
    {
      "pageId": "pd724ad0x94pnjwd67f3h96bx18jzzwx",
      "startedAt": "2026-11-26T09:18:43.821Z",
      "endExclusive": null,
      "messageCount": 2,
      "complete": true
    }
  ],
  "count": 4,
  "complete": true,
  "truncated": false,
  "prevPageId": "pd78c5absmbne6yq9c01hcrm9s8jy362",
  "nextPageId": null
}
```

The message ids are `pd77f19khak9dm0eq4ng3bkyds8jzmrq`,
`pd7f6shj4xf0btvjcg5k816qfs8jzvym`,
`pd724ad0x94pnjwd67f3h96bx18jzzwx`, `pd7ern4jdcpzwmv791fmm3tdns8jz7nd`.

### Page selection with a later page

```bash
chatroom messages download --chatroom-id=px73v73m3yty1v3m4fp3xmxr398jzp3h --role=solo \
  --page-id=pd77f19khak9dm0eq4ng3bkyds8jzmrq --after=1
```

Writes the same 4 messages from pages 2 and 3, in the same order and with the
same ids as `--before=1` above.

## 7. Exit codes and error messages

All errors exit 1 and print one `❌` line (plus a follow-up command hint where
useful).

| Error tag              | When                                                                                                              | Message (prefix)                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `PageNotFound`         | A `--page-id` was deleted or belongs to another chatroom (the server falls back to latest, so the id check fails) | `❌ Page not found: <id>. It was deleted or is not in this chatroom.` + `List current pages: chatroom messages pages ...` |
| `InvalidPage`          | A `--page-id` exists but is not a user message (not a page start)                                                 | `❌ <id> is not a page start. A page starts at a user message.` + `List pages: chatroom messages pages ...`               |
| `InvalidPageSelection` | `--before` or `--after` is not an integer in `0..50`                                                              | `❌ --before must be an integer from 0 to 50 (got "<value>")`                                                             |
| `QueryFailed`          | Any other backend query failure                                                                                   | `❌ Error fetching pages: <message>`                                                                                      |

`--max-messages` validation (in `index.ts`, before the command runs):

```
❌ --max-messages must be a positive integer
```

An empty chatroom is not an error: `pages` and `download` print the no-pages
line and exit 0.
