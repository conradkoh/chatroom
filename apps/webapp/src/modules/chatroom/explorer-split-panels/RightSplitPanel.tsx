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
} from '../direct-harness/components/ui/select';
import {
  useExplorerSplitPanelMode,
  type ExplorerSplitPanelMode,
} from '../hooks/persistence/useExplorerSplitPanelMode';
import { useMessageViewMode, type MessageViewMode } from '../hooks/persistence/useMessageViewMode';

// ─── Props ────────────────────────────────────────────────────────────────────

// Props forwarded to MessagesPanel (all except chatroomId and viewMode)
type MessagesPanelOwnProps = Omit<MessagesPanelProps, 'chatroomId' | 'viewMode'>;

export interface RightSplitPanelProps {
  chatroomId: Id<'chatroom_rooms'>;
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
}: {
  mode: ExplorerSplitPanelMode;
  setMode: (mode: ExplorerSplitPanelMode) => void;
  messageViewMode: MessageViewMode;
  setMessageViewMode: (mode: MessageViewMode) => void;
}) {
  return (
    <div className="shrink-0 h-8 border-b border-chatroom-border flex items-center justify-between gap-2 px-2">
      {mode === 'messages' ? (
        <MessageViewToggle mode={messageViewMode} onChange={setMessageViewMode} />
      ) : (
        <div aria-hidden="true" />
      )}
      <Select value={mode} onValueChange={(val) => setMode(val as ExplorerSplitPanelMode)}>
        <SelectTrigger className="h-6 text-[10px] w-36 px-2">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {(Object.keys(MODE_LABELS) as ExplorerSplitPanelMode[]).map((m) => (
            <SelectItem key={m} value={m} className="text-xs">
              {MODE_LABELS[m]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RightSplitPanel({
  chatroomId,
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
    <div className="flex flex-col min-h-0 overflow-hidden flex-1">
      <RightSplitPanelHeader
        mode={mode}
        setMode={setMode}
        messageViewMode={messageViewMode}
        setMessageViewMode={setMessageViewMode}
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
