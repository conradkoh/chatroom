'use client';
// fallow-ignore-file complexity

import { api } from '@workspace/backend/convex/_generated/api';
import type { Doc, Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { AlertTriangle, Clock3, ListTodo, Loader2, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import {
  chatroomIndustrialButtonDestructiveClassName,
  chatroomIndustrialButtonSecondaryClassName,
} from '../shared/industrialDialogStyles';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ChatroomLoader } from '@/components/ui/chatroom-loader';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollBody,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type QueueCommand = Doc<'chatroom_machineCommandInbox'>;
type QueueCommandPayload = QueueCommand['command'];

function getCommandTitle(command: QueueCommandPayload): string {
  switch (command.type) {
    case 'agent.requestStart':
      return `Start ${command.role}`;
    case 'agent.restart':
      return `Restart ${command.role}`;
    case 'agent.stop':
      return command.role ? `Stop ${command.role}` : 'Stop agents';
    case 'daemon.gitRefresh':
      return 'Refresh Git state';
    case 'daemon.refreshCapabilities':
      return 'Refresh capabilities';
    case 'daemon.localAction':
      return `Local action: ${command.action}`;
    case 'daemon.pickFolder':
      return 'Pick workspace folder';
    case 'daemon.ping':
      return 'Daemon ping';
    default:
      throw new Error('Unknown queued command');
  }
}

function getCommandDetail(command: QueueCommandPayload): string | null {
  switch (command.type) {
    case 'agent.requestStart':
    case 'agent.restart':
      return `${command.agentHarness} · ${command.model}`;
    case 'daemon.gitRefresh':
      return command.workingDir;
    case 'daemon.localAction':
      return command.workingDir;
    default:
      return null;
  }
}

function formatQueuedAt(timestamp: number): string {
  const date = new Date(timestamp);
  const day = date.getUTCDate().toString().padStart(2, '0');
  const month = date.toLocaleString('en', { month: 'short', timeZone: 'UTC' });
  const time = date.toISOString().slice(11, 16);
  return `${day} ${month} · ${time} UTC`;
}

function statusLabel(command: QueueCommand): string {
  if (command.status === 'processing') return 'Processing';
  if (command.deadline < Date.now()) return 'Expired';
  return 'Pending';
}

interface CommandQueuePanelProps {
  machineId: string | null | undefined;
}

interface CommandQueueSummaryProps {
  machineId: string | null | undefined;
  isLoading: boolean;
  commandCount: number;
  onOpen: () => void;
}

function CommandQueueSummary({
  machineId,
  isLoading,
  commandCount,
  onOpen,
}: CommandQueueSummaryProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!machineId || isLoading}
      className="w-full appearance-none border-0 border-b border-chatroom-border bg-transparent px-3 py-2 text-left transition-colors hover:bg-chatroom-bg-hover focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-chatroom-accent disabled:pointer-events-none disabled:opacity-40"
      aria-label={`Command queue: ${machineId && isLoading ? 'loading' : `${commandCount} queued commands`}`}
      data-testid="command-queue-panel"
    >
      <div className="flex items-center gap-2">
        <ListTodo size={12} className="shrink-0 text-chatroom-accent" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted">
          Command queue
        </span>
        <span
          className={cn(
            'min-w-5 px-1.5 py-0.5 text-center text-[10px] font-bold tabular-nums',
            commandCount > 0
              ? 'bg-chatroom-accent/10 text-chatroom-accent'
              : 'bg-chatroom-bg-tertiary text-chatroom-text-muted'
          )}
          aria-label={`${commandCount} queued commands`}
        >
          {machineId && isLoading ? '…' : commandCount}
        </span>
      </div>
      <p className="mt-1 pl-5 text-[10px] text-chatroom-text-muted">
        {machineId
          ? 'Commands waiting for this machine'
          : 'Select a workspace to inspect its machine'}
      </p>
    </button>
  );
}

interface QueuedCommandRowProps {
  command: QueueCommand;
  isDeleting: boolean;
  isFlushing: boolean;
  onDelete: (commandId: Id<'chatroom_machineCommandInbox'>) => void;
}

function QueuedCommandMetadata({ command }: { command: QueueCommand }) {
  const detail = getCommandDetail(command.command);

  return (
    <>
      {detail && (
        <p className="mt-1 truncate text-[10px] text-muted-foreground" title={detail}>
          {detail}
        </p>
      )}
      <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/70">
        <Clock3 size={10} aria-hidden="true" />
        {formatQueuedAt(command.createdAt)}
      </p>
    </>
  );
}

function QueuedCommandRow({ command, isDeleting, isFlushing, onDelete }: QueuedCommandRowProps) {
  const label = statusLabel(command);
  const isExpired = label === 'Expired';

  return (
    <li className="flex items-start gap-3 border-b border-chatroom-border px-5 py-3 last:border-b-0">
      <span
        className={cn(
          'mt-1.5 size-1.5 shrink-0',
          command.status === 'processing'
            ? 'bg-blue-500'
            : isExpired
              ? 'bg-amber-500'
              : 'bg-chatroom-accent'
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-xs font-semibold text-foreground">
            {getCommandTitle(command.command)}
          </p>
          <span
            className={cn(
              'text-[9px] font-bold uppercase tracking-wide',
              command.status === 'processing'
                ? 'text-blue-500'
                : isExpired
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-chatroom-accent'
            )}
          >
            {label}
          </span>
        </div>
        <QueuedCommandMetadata command={command} />
      </div>
      <button
        type="button"
        onClick={() => onDelete(command._id)}
        disabled={isDeleting || isFlushing}
        className="mt-0.5 flex size-7 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-40"
        title="Delete command"
        aria-label={`Delete ${getCommandTitle(command.command)}`}
      >
        {isDeleting ? (
          <Loader2 size={13} className="animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 size={13} aria-hidden="true" />
        )}
      </button>
    </li>
  );
}

interface QueuedCommandListProps {
  commands: QueueCommand[];
  isDeleting: (commandId: string) => boolean;
  isFlushing: boolean;
  onDelete: (commandId: Id<'chatroom_machineCommandInbox'>) => void;
}

function QueuedCommandList({ commands, isDeleting, isFlushing, onDelete }: QueuedCommandListProps) {
  if (commands.length === 0) {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
        <ListTodo size={22} className="mb-3 text-muted-foreground/60" aria-hidden="true" />
        <p className="text-xs font-medium text-foreground">Queue is clear</p>
        <p className="mt-1 text-xs text-muted-foreground">
          New agent and daemon commands will appear here.
        </p>
      </div>
    );
  }

  return (
    <ul aria-label="Queued commands">
      {commands.map((command) => (
        <QueuedCommandRow
          key={command._id}
          command={command}
          isDeleting={isDeleting(command._id)}
          isFlushing={isFlushing}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

interface CommandQueueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading: boolean;
  commands: QueueCommand[];
  commandCount: number;
  isDeleting: (commandId: string) => boolean;
  isFlushing: boolean;
  onDelete: (commandId: Id<'chatroom_machineCommandInbox'>) => void;
  onRequestFlush: () => void;
}

function CommandQueueFooter({
  commandCount,
  isFlushing,
  onClose,
  onRequestFlush,
}: Pick<CommandQueueDialogProps, 'commandCount' | 'isFlushing' | 'onRequestFlush'> & {
  onClose: () => void;
}) {
  return (
    <DialogFooter className="px-5 py-3 sm:justify-between">
      <p className="text-[10px] text-muted-foreground">
        {commandCount === 0
          ? 'Nothing to flush'
          : `${commandCount} command${commandCount === 1 ? '' : 's'} queued`}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onClose}
          className={chatroomIndustrialButtonSecondaryClassName}
        >
          Close
        </button>
        <button
          type="button"
          onClick={onRequestFlush}
          disabled={commandCount === 0 || isFlushing}
          className={cn(
            chatroomIndustrialButtonDestructiveClassName,
            'gap-1.5 disabled:cursor-not-allowed disabled:opacity-50'
          )}
        >
          <Trash2 size={13} aria-hidden="true" />
          Flush queue
        </button>
      </div>
    </DialogFooter>
  );
}

function CommandQueueDialog({
  open,
  onOpenChange,
  isLoading,
  commands,
  commandCount,
  isDeleting,
  isFlushing,
  onDelete,
  onRequestFlush,
}: CommandQueueDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90dvh,40rem)] min-h-0 w-[calc(100vw-2rem)] max-w-lg flex-col gap-0 p-0">
        <DialogHeader className="border-b border-chatroom-border px-5 py-4 pr-12">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <ListTodo size={15} className="text-chatroom-accent" aria-hidden="true" />
            Command queue
            <span className="text-muted-foreground">({commandCount})</span>
          </DialogTitle>
          <DialogDescription>
            Unacknowledged commands for the selected machine. Processing commands may already be in
            flight.
          </DialogDescription>
        </DialogHeader>

        <DialogScrollBody>
          {isLoading ? (
            <div className="flex min-h-32 items-center justify-center">
              <ChatroomLoader size="md" />
            </div>
          ) : (
            <QueuedCommandList
              commands={commands}
              isDeleting={isDeleting}
              isFlushing={isFlushing}
              onDelete={onDelete}
            />
          )}
        </DialogScrollBody>

        <CommandQueueFooter
          commandCount={commandCount}
          isFlushing={isFlushing}
          onClose={() => onOpenChange(false)}
          onRequestFlush={onRequestFlush}
        />
      </DialogContent>
    </Dialog>
  );
}

interface FlushCommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commandCount: number;
  isFlushing: boolean;
  onConfirm: () => void;
}

function FlushCommandDialog({
  open,
  onOpenChange,
  commandCount,
  isFlushing,
  onConfirm,
}: FlushCommandDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle size={17} className="text-destructive" aria-hidden="true" />
            Flush command queue?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This removes all{' '}
            {commandCount === 1 ? 'queued command' : `${commandCount} queued commands`} for this
            machine, including commands currently marked as processing. Agents that already started
            are not stopped.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isFlushing}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={isFlushing} className="gap-1.5">
            {isFlushing && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            Flush queue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface CommandQueuePanelViewProps {
  machineId: string | null | undefined;
  isOpen: boolean;
  isFlushConfirmOpen: boolean;
  isLoading: boolean;
  commands: QueueCommand[];
  commandCount: number;
  isDeleting: (commandId: string) => boolean;
  isFlushing: boolean;
  onOpenChange: (open: boolean) => void;
  onFlushConfirmChange: (open: boolean) => void;
  onDelete: (commandId: Id<'chatroom_machineCommandInbox'>) => void;
  onRequestFlush: () => void;
  onConfirmFlush: () => void;
}

function CommandQueuePanelView({
  machineId,
  isOpen,
  isFlushConfirmOpen,
  isLoading,
  commands,
  commandCount,
  isDeleting,
  isFlushing,
  onOpenChange,
  onFlushConfirmChange,
  onDelete,
  onRequestFlush,
  onConfirmFlush,
}: CommandQueuePanelViewProps) {
  return (
    <>
      <CommandQueueSummary
        machineId={machineId}
        isLoading={isLoading}
        commandCount={commandCount}
        onOpen={() => onOpenChange(true)}
      />
      <CommandQueueDialog
        open={isOpen}
        onOpenChange={onOpenChange}
        isLoading={isLoading}
        commands={commands}
        commandCount={commandCount}
        isDeleting={isDeleting}
        isFlushing={isFlushing}
        onDelete={onDelete}
        onRequestFlush={onRequestFlush}
      />
      <FlushCommandDialog
        open={isFlushConfirmOpen}
        onOpenChange={onFlushConfirmChange}
        commandCount={commandCount}
        isFlushing={isFlushing}
        onConfirm={onConfirmFlush}
      />
    </>
  );
}

export const CommandQueuePanel = memo(function CommandQueuePanel({
  machineId,
}: CommandQueuePanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isFlushConfirmOpen, setIsFlushConfirmOpen] = useState(false);
  const [deletingCommandId, setDeletingCommandId] = useState<string | null>(null);
  const [isFlushing, setIsFlushing] = useState(false);
  const commandsResult = useSessionQuery(
    api.daemon.machineCommandInbox.list,
    machineId ? { machineId } : 'skip'
  );
  const deleteCommandMutation = useSessionMutation(api.daemon.machineCommandInbox.deleteCommand);
  const deleteAllMutation = useSessionMutation(api.daemon.machineCommandInbox.deleteAll);

  const commands = useMemo(() => commandsResult ?? [], [commandsResult]);
  const isLoading = !!machineId && commandsResult === undefined;
  const commandCount = commands.length;

  const handleDelete = useCallback(
    async (commandId: Id<'chatroom_machineCommandInbox'>) => {
      setDeletingCommandId(commandId);
      try {
        await deleteCommandMutation({ commandId });
      } catch (error) {
        console.error('Failed to delete queued command:', error);
        toast.error('Failed to delete command. Please try again.');
      } finally {
        setDeletingCommandId(null);
      }
    },
    [deleteCommandMutation]
  );

  const handleFlush = useCallback(async () => {
    if (!machineId) return;
    setIsFlushing(true);
    try {
      const result = await deleteAllMutation({ machineId });
      setIsFlushConfirmOpen(false);
      toast.success(
        result.deletedCount === 1
          ? 'Removed 1 queued command'
          : `Removed ${result.deletedCount} queued commands`
      );
    } catch (error) {
      console.error('Failed to flush command queue:', error);
      toast.error('Failed to flush command queue. Please try again.');
    } finally {
      setIsFlushing(false);
    }
  }, [deleteAllMutation, machineId]);

  return (
    <CommandQueuePanelView
      machineId={machineId}
      isOpen={isOpen}
      isFlushConfirmOpen={isFlushConfirmOpen}
      isLoading={isLoading}
      commands={commands}
      commandCount={commandCount}
      isDeleting={(commandId) => deletingCommandId === commandId}
      isFlushing={isFlushing}
      onOpenChange={setIsOpen}
      onFlushConfirmChange={setIsFlushConfirmOpen}
      onDelete={(commandId) => void handleDelete(commandId)}
      onRequestFlush={() => setIsFlushConfirmOpen(true)}
      onConfirmFlush={() => void handleFlush()}
    />
  );
});
