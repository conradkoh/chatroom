/**
 * WaitForTaskSession — encapsulates the subscription lifecycle for waiting on tasks.
 *
 * Every event handler funnels through `logAndExit()` to guarantee the process
 * exits with proper logging, event identification, and reconnection guidance.
 */

import {
  type BackendError,
  type BackendErrorCode,
  FATAL_ERROR_CODES,
} from '@workspace/backend/config/errorCodes.js';
import { waitForTaskCommand } from '@workspace/backend/prompts/base/cli/wait-for-task/command.js';
import { ConvexError } from 'convex/values';
import type { SessionId } from 'convex-helpers/server/sessions';

import { api, type Id } from '../../api.js';
import type { getConvexClient } from '../../infrastructure/convex/client.js';
import { getConvexUrl, getConvexWsClient } from '../../infrastructure/convex/client.js';
import { sanitizeForTerminal, sanitizeUnknownForTerminal } from '../../utils/terminal-safety.js';

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/** Discriminated union response from `getPendingTasksForRole` subscription. */
export type WaitForTaskResponse =
  | {
      type: 'tasks';
      tasks: {
        task: { _id: Id<'chatroom_tasks'>; status: string };
        message: { _id: Id<'chatroom_messages'> } | null;
      }[];
    }
  | { type: 'no_tasks' }
  | { type: 'grace_period'; taskId: string; remainingMs: number }
  | { type: 'superseded'; newConnectionId: string }
  | { type: 'reconnect'; reason: string }
  | { type: 'error'; code: BackendErrorCode; message: string; fatal: boolean };

/** Parameters passed from the preflight phase to the session. */
export interface SessionParams {
  chatroomId: string;
  role: string;
  silent: boolean;
  sessionId: SessionId;
  connectionId: string;
  cliEnvPrefix: string;
  client: Awaited<ReturnType<typeof getConvexClient>>;
}

// ---------------------------------------------------------------------------
// WaitForTaskSession class
// ---------------------------------------------------------------------------

/**
 * Encapsulates the subscription lifecycle for waiting on tasks.
 *
 * State that was previously scattered as loose `let` variables in the function
 * scope is now held as private instance fields, making the guarantees around
 * cleanup, deduplication, and process exit explicit and auditable.
 */
export class WaitForTaskSession {
  // --- Instance state ---
  private unsubscribe: (() => void) | null = null;
  private cleanedUp = false;
  private taskProcessed = false;
  private fatalExitTriggered = false;

  // --- Injected dependencies (readonly after construction) ---
  private readonly chatroomId: string;
  private readonly role: string;
  private readonly silent: boolean;
  private readonly sessionId: SessionId;
  private readonly connectionId: string;
  private readonly cliEnvPrefix: string;
  private readonly client: SessionParams['client'];

  constructor(params: SessionParams) {
    this.chatroomId = params.chatroomId;
    this.role = params.role;
    this.silent = params.silent;
    this.sessionId = params.sessionId;
    this.connectionId = params.connectionId;
    this.cliEnvPrefix = params.cliEnvPrefix;
    this.client = params.client;
  }

  // -----------------------------------------------------------------------
  // Public entry point
  // -----------------------------------------------------------------------

  /** Start the subscription and signal handlers. */
  async start(): Promise<void> {
    this.registerSignalHandlers();
    await this.subscribe();
  }

  // -----------------------------------------------------------------------
  // Core: logAndExit
  // -----------------------------------------------------------------------

  /**
   * Cornerstone exit method — every handler funnels through here.
   *
   * 1. Logs the event type received.
   * 2. Logs the descriptive message.
   * 3. Logs reconnection guidance (the `waitForTaskCommand(...)` output).
   * 4. Fire-and-forget `cleanup()`, then synchronous `process.exit(exitCode)`.
   *
   * Return type is `never` — `process.exit()` is synchronous and truly never returns.
   */
  private logAndExit(exitCode: number, event: string, message: string, guidance: string): never {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const safeEvent = sanitizeForTerminal(event);
    const safeMessage = sanitizeForTerminal(message);
    const safeGuidance = sanitizeForTerminal(guidance);

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`[EVENT: ${safeEvent}]\n`);
    console.log(`[${timestamp}] ${safeMessage}\n`);

    if (safeGuidance) {
      console.log(safeGuidance);
    }

    console.log(`\nTo reconnect, run:`);
    console.log(
      waitForTaskCommand({
        chatroomId: this.chatroomId,
        role: this.role,
        cliEnvPrefix: this.cliEnvPrefix,
      })
    );
    console.log(`${'─'.repeat(50)}`);

    // Fire-and-forget cleanup (idempotent, best-effort — heartbeat TTL handles expiry)
    this.cleanup();

    // Synchronous process termination — truly `never` returns
    process.exit(exitCode);
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Cleanup helper — call on EVERY exit path.
   * Unsubscribes from the task subscription and tells the backend this participant has left.
   * Safe to call multiple times (idempotent).
   */
  private async cleanup(): Promise<void> {
    if (this.cleanedUp) return;
    this.cleanedUp = true;

    if (this.unsubscribe) {
      this.unsubscribe();
    }

    try {
      // Record the stop action before leaving
      await this.client.mutation(api.participants.join, {
        sessionId: this.sessionId,
        chatroomId: this.chatroomId as Id<'chatroom_rooms'>,
        role: this.role,
        action: 'wait-for-task:stopped',
      });
    } catch {
      // Best-effort
    }

    try {
      await this.client.mutation(api.participants.leave, {
        sessionId: this.sessionId,
        chatroomId: this.chatroomId as Id<'chatroom_rooms'>,
        role: this.role,
      });
    } catch {
      // Best-effort — if the backend is unreachable, leave is skipped
    }
  }

  // -----------------------------------------------------------------------
  // Subscription
  // -----------------------------------------------------------------------

  private async subscribe(): Promise<void> {
    const wsClient = await getConvexWsClient();
    this.unsubscribe = wsClient.onUpdate(
      api.tasks.getPendingTasksForRole,
      {
        sessionId: this.sessionId,
        chatroomId: this.chatroomId as Id<'chatroom_rooms'>,
        role: this.role,
        connectionId: this.connectionId,
      },
      (response: WaitForTaskResponse) => {
        this.handleSubscriptionResponse(response).catch((error) => {
          console.error(`❌ Error processing task: ${(error as Error).message}`);
        });
      },
      (error: Error) => {
        this.handleSubscriptionError(error, 'task subscription');
      }
    );
  }

  // -----------------------------------------------------------------------
  // Event handlers
  // -----------------------------------------------------------------------

  /** Handle the discriminated union response from subscription. */
  private async handleSubscriptionResponse(response: WaitForTaskResponse): Promise<void> {
    if (this.taskProcessed) return;

    switch (response.type) {
      case 'no_tasks':
        // No tasks yet — subscription will notify us when there are.
        // This is the normal idle state; do not exit.
        return;

      case 'superseded':
        this.handleSuperseded();
        return;

      case 'grace_period':
        this.handleGracePeriod(response);
        return;

      case 'error':
        this.handleError(response);
        return;

      case 'reconnect':
        this.handleReconnect(response);
        return;

      case 'tasks':
        await this.handleTasks(response);
        return;
    }
  }

  /**
   * Another process has taken over this role's connection.
   * Exit gracefully so the old agent process terminates cleanly.
   */
  private handleSuperseded(): never {
    this.logAndExit(
      0,
      'superseded',
      'Another wait-for-task process started for this role.',
      'Impact: This process is being replaced by the newer connection.\n' +
        'Action: This is expected if you started a new wait-for-task session.'
    );
  }

  /**
   * Task is in grace period — another agent may still be working on it.
   * Exit with guidance to reconnect.
   */
  private handleGracePeriod(response: { taskId: string; remainingMs: number }): never {
    const remainingSec = Math.ceil(response.remainingMs / 1000);
    this.logAndExit(
      0,
      'grace_period',
      `Task ${response.taskId} was recently acknowledged (${remainingSec}s grace remaining).`,
      'Impact: Another agent may still be processing this task.\n' +
        'Action: Wait for the grace period to expire, then reconnect.'
    );
  }

  /**
   * Backend requested a reconnect.
   * Exit with the reason and reconnection guidance.
   */
  private handleReconnect(response: { reason: string }): never {
    this.logAndExit(
      0,
      'reconnect',
      `Backend requested reconnect: ${response.reason}`,
      'Action: Reconnect to resume listening for tasks.'
    );
  }

  /**
   * Error event from the subscription.
   * Fatal errors exit with code 1; non-fatal errors exit with code 0.
   */
  private handleError(response: { code: BackendErrorCode; message: string; fatal: boolean }): void {
    if (response.fatal) {
      if (this.fatalExitTriggered) return;
      this.fatalExitTriggered = true;
      this.logAndExit(
        1,
        'error (fatal)',
        `❌ FATAL ERROR — [${response.code}] ${response.message}`,
        'This is an unrecoverable error. The process will now exit.'
      );
    }
    // Non-fatal error — exit with code 0 and guidance
    this.logAndExit(
      0,
      'error (non-fatal)',
      `⚠️ Non-fatal error: [${response.code}] ${response.message}`,
      'Action: Reconnect to resume listening for tasks.'
    );
  }

  /**
   * Handle errors from WebSocket subscription callbacks.
   * - ConvexError with a fatal code → logAndExit(1)
   * - ConvexError with a non-fatal code → logAndExit(0)
   * - Non-ConvexError (network, transient) → logAndExit(0)
   */
  private handleSubscriptionError(error: Error, source: string): void {
    if (error instanceof ConvexError) {
      const data = error.data as BackendError;
      if (data?.code && FATAL_ERROR_CODES.includes(data.code)) {
        if (this.fatalExitTriggered) return;
        this.fatalExitTriggered = true;
        this.logAndExit(
          1,
          'subscription_error (fatal)',
          `❌ FATAL ERROR in ${source} — [${data.code}] ${data.message}`,
          'This is an unrecoverable error. The process will now exit.'
        );
        return;
      }
      // Non-fatal ConvexError — exit with guidance
      this.logAndExit(
        0,
        'subscription_error (non-fatal)',
        `⚠️ Non-fatal error in ${source}: [${data?.code}] ${data?.message ?? error.message}`,
        'Action: Reconnect to resume listening for tasks.'
      );
      return;
    }
    // Non-ConvexError (network, transient) — exit with guidance
    this.logAndExit(
      0,
      'subscription_error (transient)',
      `⚠️ Transient error in ${source}: ${error.message}`,
      'Action: Reconnect to resume listening for tasks.'
    );
  }

  /**
   * Process received tasks — claim, deliver, and exit.
   * Exit 0 on success, exit 1 on delivery failure.
   */
  private async handleTasks(response: WaitForTaskResponse & { type: 'tasks' }): Promise<void> {
    const pendingTasks = response.tasks;
    const taskWithMessage = pendingTasks.length > 0 ? pendingTasks[0] : null;

    if (!taskWithMessage) {
      // No tasks in the response array (shouldn't happen with type='tasks', but guard)
      return;
    }

    const { task, message } = taskWithMessage;

    // Handle based on task status
    if (task.status !== 'acknowledged') {
      // Pending task — claim it (transition: pending → acknowledged)
      try {
        await this.client.mutation(api.tasks.claimTask, {
          sessionId: this.sessionId,
          chatroomId: this.chatroomId as Id<'chatroom_rooms'>,
          role: this.role,
          taskId: task._id,
        });
      } catch (_claimError) {
        console.log(`🔄 Task already claimed by another agent, continuing to wait...`);
        return;
      }
    }

    // Mark as processed to prevent duplicate handling
    this.taskProcessed = true;

    // Unsubscribe early — we've claimed the task and are transitioning to delivery.
    if (this.unsubscribe) this.unsubscribe();
    this.cleanedUp = true; // Prevent cleanup() from calling leave on exit

    try {
      // Also claim the message if it exists (for compatibility)
      if (message) {
        await this.client.mutation(api.messages.claimMessage, {
          sessionId: this.sessionId,
          messageId: message._id,
          role: this.role,
        });
      }

      // Get the complete task delivery prompt from backend
      const taskDeliveryPrompt = await this.client.query(api.messages.getTaskDeliveryPrompt, {
        sessionId: this.sessionId,
        chatroomId: this.chatroomId as Id<'chatroom_rooms'>,
        role: this.role,
        taskId: task._id,
        messageId: message?._id,
        convexUrl: getConvexUrl(),
      });

      // Log task received with timestamp
      const taskReceivedTime = new Date().toISOString().replace('T', ' ').substring(0, 19);
      console.log(`\n[${taskReceivedTime}] 📨 Task received!\n`);

      // Print the complete backend-generated output
      console.log(sanitizeForTerminal(taskDeliveryPrompt.fullCliOutput));

      process.exit(0);
    } catch (deliveryError) {
      // Task was claimed but delivery failed — MUST exit so the agent regains control.
      this.logAndExit(
        1,
        'task_delivery_failed',
        `⚠️ TASK CLAIMED BUT DELIVERY FAILED — ${sanitizeUnknownForTerminal((deliveryError as Error).message)}`,
        `Task ID: ${task._id}\n` +
          `The task has been claimed for your role.\n` +
          `Use context read to see your current task:\n\n` +
          `   ${this.cliEnvPrefix} chatroom context read --chatroom-id=${this.chatroomId} --role=${this.role}`
      );
    }
  }

  // -----------------------------------------------------------------------
  // Signal handlers
  // -----------------------------------------------------------------------

  private registerSignalHandlers(): void {
    const handleSignal = (_signal: string) => {
      this.logAndExit(
        0,
        `signal (${_signal})`,
        `Process interrupted (${_signal}).`,
        'Impact: You are no longer listening for tasks.\n' +
          'Action: Run the reconnect command immediately to resume availability.'
      );
    };

    process.on('SIGINT', () => handleSignal('SIGINT'));
    process.on('SIGTERM', () => handleSignal('SIGTERM'));
    process.on('SIGHUP', () => handleSignal('SIGHUP'));
  }
}
