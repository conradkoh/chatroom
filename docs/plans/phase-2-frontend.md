# Phase 2: Frontend Migration

## Overview

Migrate the chatroom web dashboard from `chatroom-cli/src/web/` to `chatroom/apps/webapp/`.

## Source Files

From `chatroom-cli/src/web/`:
- `app/App.tsx` - Main dashboard component
- `app/main.tsx` - React entry point
- `app/styles/index.css` - Styling
- `app/components/` - UI components:
  - `AgentPanel.tsx` - Agent status display
  - `ChatroomSelector.tsx` - Chatroom list and selection
  - `CopyButton.tsx` - Copy to clipboard utility
  - `CreateChatroomForm.tsx` - Create new chatroom form
  - `ErrorBoundary.tsx` - Error handling
  - `MessageFeed.tsx` - Message display with markdown
  - `PromptModal.tsx` - Agent prompt display modal
  - `SendForm.tsx` - Message send form
  - `SetupChecklist.tsx` - Team setup checklist
  - `TeamStatus.tsx` - Team readiness display
  - `WorkingIndicator.tsx` - Activity indicator

From `chatroom-cli/src/domain/`:
- `prompts/generator.ts` - Prompt generation
- `prompts/templates.ts` - Role templates
- `prompts/init/` - Prompt initialization sections
- `prompts/handoff/` - Handoff instructions
- `entities/role-hierarchy.ts` - Role hierarchy (client-side)

## Tasks

### 2.1 Create Chatroom Module
Create `apps/webapp/src/modules/chatroom/`:

**Components to Create:**
- `ChatroomDashboard.tsx` - Main dashboard (from App.tsx)
- `ChatroomSelector.tsx` - Chatroom list and selector
- `components/AgentPanel.tsx` - Agent status
- `components/MessageFeed.tsx` - Message display
- `components/SendForm.tsx` - Send message form
- `components/TeamStatus.tsx` - Team status
- `components/SetupChecklist.tsx` - Setup wizard
- `components/PromptModal.tsx` - Prompt display
- `components/CopyButton.tsx` - Copy utility

**Hooks to Create:**
- `use-chatroom-sync.ts` - Real-time chatroom sync
- `use-participants.ts` - Participant state management

**Utilities:**
- `prompts/generator.ts` - Prompt generation
- `prompts/templates.ts` - Role templates
- `role-hierarchy.ts` - Client-side hierarchy

### 2.2 Create Pages
Add new pages in `apps/webapp/src/app/`:

**Pages:**
- `app/chatroom/page.tsx` - Chatroom selector/dashboard entry
- `app/chatroom/[id]/page.tsx` - Individual chatroom view

### 2.3 Adapt Styling
Convert CSS to match target app's styling approach:

**Options:**
- Use Tailwind CSS (target uses Tailwind)
- Use existing shadcn/ui components where applicable
- Create dedicated CSS module if needed

### 2.4 Update Dependencies
Add required dependencies to `apps/webapp/package.json`:

```json
{
  "dependencies": {
    "react-markdown": "^10.x",
    "remark-gfm": "^4.x",
    "lucide-react": "^0.x"  // Already present
  }
}
```

## Component Mapping

| Source Component | Target Component |
|-----------------|------------------|
| `App.tsx` | `ChatroomDashboard.tsx` |
| `AgentPanel.tsx` | `components/AgentPanel.tsx` |
| `ChatroomSelector.tsx` | `ChatroomSelector.tsx` |
| `MessageFeed.tsx` | `components/MessageFeed.tsx` |
| `SendForm.tsx` | `components/SendForm.tsx` |
| `TeamStatus.tsx` | `components/TeamStatus.tsx` |
| `SetupChecklist.tsx` | `components/SetupChecklist.tsx` |
| `PromptModal.tsx` | `components/PromptModal.tsx` |

## File Structure

After migration:
```
apps/webapp/src/
├── app/
│   └── app/
│       └── chatroom/
│           ├── page.tsx
│           └── [id]/
│               └── page.tsx
└── modules/
    └── chatroom/
        ├── ChatroomDashboard.tsx
        ├── ChatroomSelector.tsx
        ├── components/
        │   ├── AgentPanel.tsx
        │   ├── CopyButton.tsx
        │   ├── MessageFeed.tsx
        │   ├── PromptModal.tsx
        │   ├── SendForm.tsx
        │   ├── SetupChecklist.tsx
        │   ├── TeamStatus.tsx
        │   └── WorkingIndicator.tsx
        ├── hooks/
        │   ├── use-chatroom-sync.ts
        │   └── use-participants.ts
        ├── prompts/
        │   ├── generator.ts
        │   ├── templates.ts
        │   └── init/
        │       └── index.ts
        └── role-hierarchy.ts
```

## Verification

1. Run `pnpm typecheck` in webapp package
2. Test chatroom page renders correctly
3. Verify real-time updates work
4. Test message sending and display
5. Verify prompt generation and copy
