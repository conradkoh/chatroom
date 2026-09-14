'use client';
// fallow-ignore-file complexity

import { api } from '@workspace/backend/convex/_generated/api';
import type { Doc, Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { AlertTriangle, Clock3, ListTodo, Loader2, Trash2 } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

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
import { Button } from '@/components/ui/button';
import { ChatroomLoader } from '@/components/ui/chatroom-loader';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
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
    <>
      <div className="border-b border-chatroom-border px-3 py-2" data-testid="command-queue-panel">
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
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            disabled={!machineId || isLoading}
            className="text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted transition-colors hover:text-chatroom-text-primary disabled:pointer-events-none disabled:opacity-40"
            title="View command queue"
          >
            View
          </button>
        </div>
        <p className="mt-1 pl-5 text-[10px] text-chatroom-text-muted">
          {machineId
            ? 'Commands waiting for this machine'
            : 'Select a workspace to inspect its machine'}
        </p>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4 pr-12">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <ListTodo size={15} className="text-chatroom-accent" aria-hidden="true" />
              Command queue
              <span className="text-muted-foreground">({commandCount})</span>
            </DialogTitle>
            <DialogDescription>
              Unacknowledged commands for the selected machine. Processing commands may already be
              in flight.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[min(60vh,28rem)] overflow-y-auto">
            {isLoading ? (
              <div className="flex min-h-32 items-center justify-center">
                <ChatroomLoader size="md" />
              </div>
            ) : commandCount === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
                <ListTodo size={22} className="mb-3 text-muted-foreground/60" aria-hidden="true" />
                <p className="text-xs font-medium text-foreground">Queue is clear</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  New agent and daemon commands will appear here.
                </p>
              </div>
            ) : (
              <ul aria-label="Queued commands">
                {commands.map((command) => {
                  const detail = getCommandDetail(command.command);
                  const isDeleting = deletingCommandId === command._id;
                  const label = statusLabel(command);
                  const isExpired = label === 'Expired';
                  return (
                    <li
                      key={command._id}
                      className="flex items-start gap-3 border-b border-border px-5 py-3 last:border-b-0"
                    >
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
                        {detail && (
                          <p
                            className="mt-1 truncate text-[10px] text-muted-foreground"
                            title={detail}
                          >
                            {detail}
                          </p>
                        )}
                        <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/70">
                          <Clock3 size={10} aria-hidden="true" />
                          {formatQueuedAt(command.createdAt)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDelete(command._id)}
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
                })}
              </ul>
            )}
          </div>

          <DialogFooter className="border-t border-border px-5 py-3 sm:justify-between">
            <p className="text-[10px] text-muted-foreground">
              {commandCount === 0
                ? 'Nothing to flush'
                : `${commandCount} command${commandCount === 1 ? '' : 's'} queued`}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsOpen(false)}>
                Close
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setIsFlushConfirmOpen(true)}
                disabled={commandCount === 0 || isFlushing}
              >
                <Trash2 size={13} aria-hidden="true" />
                Flush queue
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isFlushConfirmOpen} onOpenChange={setIsFlushConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle size={17} className="text-destructive" aria-hidden="true" />
              Flush command queue?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes all{' '}
              {commandCount === 1 ? 'queued command' : `${commandCount} queued commands`} for this
              machine, including commands currently marked as processing. Agents that already
              started are not stopped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isFlushing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleFlush()}
              disabled={isFlushing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isFlushing && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              Flush queue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});
