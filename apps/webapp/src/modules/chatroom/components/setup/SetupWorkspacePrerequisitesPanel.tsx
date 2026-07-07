'use client';

import { SetupPrerequisiteRow } from './SetupPrerequisiteRow';

const HARNESS_INSTALL_COMMAND =
  '# Install a supported harness:\nnpm install -g opencode-ai   # opencode\nnpm install -g @plandex/pi   # pi';

interface SetupWorkspacePrerequisitesPanelProps {
  daemonDone: boolean;
  harnessDone: boolean;
  detectedHarnesses: string[];
  authLoginCommand?: string;
  daemonStartCommand?: string;
}

export function SetupWorkspacePrerequisitesPanel({
  daemonDone,
  harnessDone,
  detectedHarnesses,
  authLoginCommand,
  daemonStartCommand,
}: SetupWorkspacePrerequisitesPanelProps) {
  const showSetupCommands = authLoginCommand !== undefined && daemonStartCommand !== undefined;

  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted mb-3">
        Prerequisites
      </h3>
      <div className="flex flex-col gap-2">
        {showSetupCommands ? (
          <>
            <SetupPrerequisiteRow done={false} label="Auth login" command={authLoginCommand} />
            <SetupPrerequisiteRow
              done={false}
              label="Daemon connected"
              command={daemonStartCommand}
            />
          </>
        ) : (
          <>
            <SetupPrerequisiteRow
              done={daemonDone}
              label="Daemon connected"
              doneDetail="Machine online"
            />
            <SetupPrerequisiteRow
              done={harnessDone}
              label="Harness installed"
              command={harnessDone ? undefined : HARNESS_INSTALL_COMMAND}
              doneDetail={harnessDone ? detectedHarnesses.join(', ') : undefined}
            />
          </>
        )}
      </div>
    </div>
  );
}
