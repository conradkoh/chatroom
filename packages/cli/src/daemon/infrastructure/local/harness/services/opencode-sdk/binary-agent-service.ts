import { BaseCLIAgentService } from '../base-cli-agent-service.js';

export const OPENCODE_COMMAND = 'opencode';

function parseOpencodeModelsOutput(output: string | null): string[] {
  if (output === null) return [];

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export abstract class OpenCodeBinaryAgentService extends BaseCLIAgentService {
  readonly command = OPENCODE_COMMAND;
  protected abstract readonly listModelsHarnessId: string;

  async isInstalled(): Promise<boolean> {
    return this.checkInstalled(OPENCODE_COMMAND);
  }

  async getVersion(): Promise<Awaited<ReturnType<typeof this.checkVersion>>> {
    return this.checkVersion(OPENCODE_COMMAND);
  }

  async listModels(): Promise<string[]> {
    const output = await this.runListCommand(
      this.listModelsHarnessId,
      `${OPENCODE_COMMAND} models`
    );
    return parseOpencodeModelsOutput(output);
  }
}
