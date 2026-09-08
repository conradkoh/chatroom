import { createAssistantTextCapture } from './assistant-text-capture.js';
import {
  createTurnCompletion,
  type TurnCompletion,
  type TurnCompletionInput,
  type TurnCompletionResult,
} from './turn-completion.js';
import { formatAgentLogLine } from './agent-log-format.js';
import {
  createHarnessActivityEmitter,
  type HarnessActivityEmitter,
} from '../../../../services/service-interfaces.js';

type AgentEndCallback = () => void;
type OutputCallback = () => void;
type TurnResultCallback = (result: TurnCompletionResult) => void;

/** Shared callback wiring for cursor-sdk and pi-sdk stream adapters. */
export abstract class NativeStreamAdapterBase {
  protected readonly agentEndCallbacks: AgentEndCallback[] = [];
  protected readonly outputCallbacks: OutputCallback[] = [];
  protected readonly assistantTextCapture = createAssistantTextCapture();
  public readonly activityEmitter: HarnessActivityEmitter;
  public readonly turnCompletion: TurnCompletion;
  private readonly turnResultCallbacks: TurnResultCallback[] = [];

  constructor(
    protected readonly logPrefix: string,
    protected readonly emitLogLine?: (line: string) => void,
    activityEmitter: HarnessActivityEmitter = createHarnessActivityEmitter(),
    turnCompletion: TurnCompletion = createTurnCompletion()
  ) {
    this.activityEmitter = activityEmitter;
    this.turnCompletion = turnCompletion;
    this.turnCompletion.onComplete((result) => {
      this.writeLine(
        formatAgentLogLine(
          this.logPrefix,
          'agent_end',
          result.status === 'completed' ? undefined : `reason: ${result.status}`
        )
      );
      for (const cb of this.turnResultCallbacks) cb(result);
      for (const cb of this.agentEndCallbacks) cb();
    });
  }

  setAssistantTextCapture(cb: (text: string) => void): void {
    this.assistantTextCapture.setAssistantTextCapture(cb);
  }

  onAgentEnd(cb: AgentEndCallback): void {
    this.agentEndCallbacks.push(cb);
  }

  onTurnResult(cb: TurnResultCallback): () => void {
    this.turnResultCallbacks.push(cb);
    return () => {
      const index = this.turnResultCallbacks.indexOf(cb);
      if (index >= 0) this.turnResultCallbacks.splice(index, 1);
    };
  }

  completeTurn(input: TurnCompletionInput): boolean {
    return this.turnCompletion.complete(input);
  }

  onOutput(cb: OutputCallback): void {
    this.outputCallbacks.push(cb);
  }

  protected notifyOutput(source = 'native-sdk.event'): void {
    this.activityEmitter.emit({
      kind: 'transport',
      source,
      at: Date.now(),
    });
    for (const cb of this.outputCallbacks) cb();
  }

  protected notifyProgress(source: string): void {
    this.activityEmitter.emit({
      kind: 'progress',
      source,
      at: Date.now(),
    });
  }

  protected notifyWaiting(source: string): void {
    this.activityEmitter.emit({
      kind: 'waiting',
      source,
      at: Date.now(),
    });
  }

  protected notifyFailure(source: string): void {
    this.activityEmitter.emit({
      kind: 'failure',
      source,
      at: Date.now(),
    });
  }

  protected writeLine(line: string): void {
    this.emitLogLine?.(line);
  }
}
