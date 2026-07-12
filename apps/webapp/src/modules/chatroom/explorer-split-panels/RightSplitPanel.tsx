'use client';

/**
 * RightSplitPanel — the right side of the explorer-split view.
 *
 * Contains a header with a mode dropdown that switches between:
 *   • Messages (ChatroomTimelineFeed + SendForm)
 *   • Direct Harness (session browser/composer)
 *
 * Mode is persisted per chatroom via useExplorerSplitPanelMode.
 * Only available in the explorer-split view (md+ screens).
 */

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { DirectHarnessPanel } from './DirectHarnessPanel';
import { MessagesPanel, type MessagesPanelProps } from './MessagesPanel';
import { MessageViewToggle } from '../components/timeline/MessageViewToggle';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  useExplorerSplitPanelMode,
  type ExplorerSplitPanelMode,
} from '../hooks/persistence/useExplorerSplitPanelMode';
import { useMessageViewMode, type MessageViewMode } from '../hooks/persistence/useMessageViewMode';
import { WorkspaceTabBarShell } from '../workspace/components/WorkspaceTabBar';

// ─── Props ────────────────────────────────────────────────────────────────────

// Props forwarded to MessagesPanel (all except chatroomId and viewMode)
type MessagesPanelOwnProps = Omit<MessagesPanelProps, 'chatroomId' | 'viewMode'>;

export interface RightSplitPanelProps {
  chatroomId: Id<'chatroom_rooms'>;
  teamRoles: string[];
  messagesPanelProps: MessagesPanelOwnProps;
  /** Selected harness session ID, persisted by the parent lifecycle hook. */
  selectedHarnessSessionId: string | null;
  /** Setter for the selected harness session ID. */
  setSelectedHarnessSessionId: (id: string | null) => void;
  /** Optional mode override (when managed by parent lifecycle hook). */
  mode?: ExplorerSplitPanelMode;
  /** Optional mode setter (when managed by parent lifecycle hook). */
  setMode?: (mode: ExplorerSplitPanelMode) => void;
}

// ─── Mode labels ──────────────────────────────────────────────────────────────

const MODE_LABELS: Record<ExplorerSplitPanelMode, string> = {
  messages: 'Messages',
  'direct-harness': 'Direct Harness',
};

function RightSplitPanelHeader({
  mode,
  setMode,
  messageViewMode,
  setMessageViewMode,
  teamRoles,
}: {
  mode: ExplorerSplitPanelMode;
  setMode: (mode: ExplorerSplitPanelMode) => void;
  messageViewMode: MessageViewMode;
  setMessageViewMode: (mode: MessageViewMode) => void;
  teamRoles: string[];
}) {
  return (
    <WorkspaceTabBarShell testId="right-split-panel-header">
      <div className="flex h-full min-w-0 flex-1 items-center justify-between gap-2 px-2">
        {mode === 'messages' ? (
          <MessageViewToggle
            mode={messageViewMode}
            onChange={setMessageViewMode}
            teamRoles={teamRoles}
          />
        ) : (
          <div aria-hidden="true" />
        )}
        <Select value={mode} onValueChange={(val) => setMode(val as ExplorerSplitPanelMode)}>
          <SelectTrigger
            size="sm"
            className="!h-6 py-0 px-2 text-[10px] w-36 shrink-0 bg-chatroom-bg-surface border border-chatroom-border text-chatroom-text-primary rounded-none focus:ring-0 focus:outline-none [&_svg]:size-3"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(MODE_LABELS) as ExplorerSplitPanelMode[]).map((m) => (
              <SelectItem key={m} value={m} className="text-xs">
                {MODE_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </WorkspaceTabBarShell>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RightSplitPanel({
  chatroomId,
  teamRoles,
  messagesPanelProps,
  selectedHarnessSessionId,
  setSelectedHarnessSessionId,
  mode: modeProp,
  setMode: setModeProp,
}: RightSplitPanelProps) {
  const [internalMode, internalSetMode] = useExplorerSplitPanelMode(chatroomId);
  const mode = modeProp ?? internalMode;
  const setMode = setModeProp ?? internalSetMode;
  const [messageViewMode, setMessageViewMode] = useMessageViewMode(chatroomId);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <RightSplitPanelHeader
        mode={mode}
        setMode={setMode}
        messageViewMode={messageViewMode}
        setMessageViewMode={setMessageViewMode}
        teamRoles={teamRoles}
      />

      {/* Body: panel content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {mode === 'messages' ? (
          <MessagesPanel
            chatroomId={chatroomId as string}
            viewMode={messageViewMode}
            {...messagesPanelProps}
          />
        ) : (
          <DirectHarnessPanel
            chatroomId={chatroomId}
            selectedSessionId={selectedHarnessSessionId}
            setSelectedSessionId={setSelectedHarnessSessionId}
          />
        )}
      </div>
    </div>
  );
}
