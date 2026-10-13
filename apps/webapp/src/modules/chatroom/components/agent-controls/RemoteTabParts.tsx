'use client';

import {
  AlertCircle,
  ChevronDown,
  Loader2,
  Play,
  RotateCw,
  Save,
  Square,
  Star,
} from 'lucide-react';

import {
  deriveHarnessDisabled,
  deriveModelWarning,
  isDaemonConnected,
  shouldShowSelectHint,
} from './remoteTabDerivations';
import type { RemoteTabModel } from './useRemoteTabModel';
import type { MachineConnectivity } from '../../../../hooks/useDaemonConnectivity';
import type { MachineConfigEntry } from '../../features/machine-config/types/machineConfig';
import {
  formatHarnessLabel,
  getMachineDisplayName,
  getModelDisplayLabel,
  type AgentHarness,
  type HarnessVersionInfo,
  type MachineInfo,
} from '../../types/machine';
import type { useAgentControls } from '../AgentControls';
import { MachineConfigQuickPick } from '../AgentPanel/MachineConfigQuickPick';
import { CopyButton } from '../CopyButton';
import { MachineCapabilitiesRefreshButton } from '../MachineCapabilitiesRefreshButton';
import { ModelFilterButton, ModelPickerField, ModelPickerMeta } from '../model-selection';
import { PickerOptionRow, PickerScrollBody, PickerSearch, ResponsivePickerShell } from '../picker';

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
import { cn } from '@/lib/utils';

/** The machine's display name, or its id when it is not in the connected list, or a placeholder. */
function machineLabelFor(connectedMachines: MachineInfo[], machineId: string | null): string {
  if (!machineId) return 'Machine...';
  const machine = connectedMachines.find((m) => m.machineId === machineId);
  return machine ? getMachineDisplayName(machine) : machineId;
}

function harnessLabelFor(
  harness: AgentHarness | null,
  versions: Partial<Record<AgentHarness, HarnessVersionInfo>>
): string {
  return harness ? formatHarnessLabel(harness, versions[harness]) : 'Harness...';
}

/** Label of the read-only model while an agent runs. */
function runningModelText(modelUnavailable: boolean, displayModel: string | null): string {
  if (modelUnavailable) return 'No models available';
  return displayModel ? getModelDisplayLabel(displayModel) : 'Model...';
}

/** Value of the model picker. Empty while the model is unavailable. */
function modelPickerValue(modelUnavailable: boolean, displayModel: string | null): string {
  return modelUnavailable ? '' : (displayModel ?? '');
}

function favoriteToggleLabel(isFavorite: boolean): string {
  return isFavorite ? 'Remove current config from favorites' : 'Add current config to favorites';
}

/** The favourite button needs a machine and a current config. */
function showFavoriteToggle(machineId: string | null, entry: MachineConfigEntry | null): boolean {
  return !!machineId && !!entry;
}

/** The model filter button needs a machine and a harness. */
function showModelFilter(machineId: string | null, harness: AgentHarness | null): boolean {
  return !!machineId && !!harness;
}

type Controls = ReturnType<typeof useAgentControls>;

const BASE_READ_ONLY =
  'w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 opacity-50 truncate';

const ACTION_BUTTON = 'w-7 h-7 flex items-center justify-center transition-all';

interface RowProps {
  controls: Controls;
  model: RemoteTabModel;
}

// ─── Empty states ───────────────────────────────────────────────────

export function LoadingNotice() {
  return (
    <div className="flex items-center justify-center py-1">
      <Loader2 size={14} className="animate-spin text-chatroom-text-muted" />
      <span className="ml-2 text-[10px] text-chatroom-text-muted">Loading machines...</span>
    </div>
  );
}

export function NoMachinesNotice({ daemonStartCommand }: { daemonStartCommand: string }) {
  return (
    <div className="space-y-2 py-1">
      <div className="flex items-center gap-2">
        <AlertCircle size={12} className="text-chatroom-status-warning flex-shrink-0" />
        <span className="text-[10px] text-chatroom-text-secondary">
          No machines registered. Run:
        </span>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-[10px] font-mono text-chatroom-status-success bg-chatroom-bg-tertiary px-2 py-1.5 border border-chatroom-border break-all">
          {daemonStartCommand}
        </code>
        <CopyButton
          text={daemonStartCommand}
          label="Copy"
          copiedLabel="Copied!"
          variant="compact"
        />
      </div>
    </div>
  );
}

// ─── Machine and harness ────────────────────────────────────────────

/** The machine picker. While an agent runs, it shows the machine read-only. */
function MachineField({
  controls,
  model,
  connectedMachines,
}: RowProps & { connectedMachines: MachineInfo[] }) {
  const { isBusy, isAgentRunning, handleMachineChange } = controls;
  const { machinePicker, filteredMachines, display } = model;
  const label = machineLabelFor(connectedMachines, display.machineId);
  return (
    <div className="flex-1 min-w-0">
      {isAgentRunning ? (
        <div className={BASE_READ_ONLY}>{label}</div>
      ) : (
        <ResponsivePickerShell
          open={machinePicker.open}
          onOpenChange={machinePicker.handleOpenChange}
          disabled={isBusy}
          title="Select machine"
          align="start"
          contentClassName="w-72"
          trigger={
            <button
              disabled={isBusy}
              className="w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 h-auto hover:border-chatroom-border-strong focus:outline-none focus:border-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
              title="Select Machine"
            >
              <span className="truncate">{label}</span>
              <ChevronDown size={10} className="ml-1 flex-shrink-0 text-chatroom-text-muted" />
            </button>
          }
        >
          <PickerSearch
            value={machinePicker.searchTerm}
            onChange={machinePicker.setSearchTerm}
            placeholder="Search machines…"
          />
          <PickerScrollBody maxHeightClassName="max-h-60">
            {filteredMachines.length === 0 ? (
              <p className="px-3 py-2 text-xs text-chatroom-text-muted">No machines found.</p>
            ) : (
              filteredMachines.map((machine) => (
                <PickerOptionRow
                  key={machine.machineId}
                  selected={display.machineId === machine.machineId}
                  onSelect={() => {
                    handleMachineChange(machine.machineId);
                    machinePicker.handleOpenChange(false);
                  }}
                >
                  {getMachineDisplayName(machine)}
                </PickerOptionRow>
              ))
            )}
          </PickerScrollBody>
        </ResponsivePickerShell>
      )}
    </div>
  );
}

/** The harness picker. While an agent runs, it shows the harness read-only. */
function HarnessField({ controls, model }: RowProps) {
  const { isBusy, isAgentRunning, availableHarnessesForMachine, harnessVersionsForMachine } =
    controls;
  const { harnessPicker, filteredHarnesses, display, displayHarnessVersionsForMachine } = model;
  const { handleHarnessChange } = controls;
  const disabled = deriveHarnessDisabled(
    isBusy,
    display.machineId,
    availableHarnessesForMachine.length
  );
  const label = harnessLabelFor(display.harness, displayHarnessVersionsForMachine);
  return (
    <div className="min-w-0 flex-1">
      {isAgentRunning ? (
        <div className={BASE_READ_ONLY}>{label}</div>
      ) : (
        <ResponsivePickerShell
          open={harnessPicker.open}
          onOpenChange={harnessPicker.handleOpenChange}
          disabled={disabled}
          title="Select harness"
          align="start"
          contentClassName="w-72"
          trigger={
            <button
              disabled={disabled}
              className="w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 h-auto hover:border-chatroom-border-strong focus:outline-none focus:border-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between"
              title="Select Harness"
            >
              <span className="truncate flex items-center min-w-0">{label}</span>
              <ChevronDown size={10} className="ml-1 flex-shrink-0 text-chatroom-text-muted" />
            </button>
          }
        >
          <PickerSearch
            value={harnessPicker.searchTerm}
            onChange={harnessPicker.setSearchTerm}
            placeholder="Search harnesses…"
          />
          <PickerScrollBody maxHeightClassName="max-h-60">
            {filteredHarnesses.length === 0 ? (
              <p className="px-3 py-2 text-xs text-chatroom-text-muted">No harnesses found.</p>
            ) : (
              filteredHarnesses.map((harness) => {
                const optionLabel = formatHarnessLabel(harness, harnessVersionsForMachine[harness]);
                return (
                  <PickerOptionRow
                    key={harness}
                    selected={display.harness === harness}
                    onSelect={() => {
                      handleHarnessChange(harness);
                      harnessPicker.handleOpenChange(false);
                    }}
                  >
                    {optionLabel}
                  </PickerOptionRow>
                );
              })
            )}
          </PickerScrollBody>
        </ResponsivePickerShell>
      )}
    </div>
  );
}

/** Machine and harness on one row, with the capabilities refresh once a machine is shown. */
function MachineHarnessRow({
  controls,
  model,
  connectedMachines,
  setupMode,
  daemonConnectivity,
  chatroomId,
}: RowProps & {
  connectedMachines: MachineInfo[];
  setupMode: boolean;
  daemonConnectivity?: Map<string, MachineConnectivity>;
  chatroomId: string;
}) {
  const { display, linkedMachineIds } = model;
  return (
    <div className="flex items-start gap-2">
      {!setupMode && (
        <MachineField controls={controls} model={model} connectedMachines={connectedMachines} />
      )}
      <div className="flex-1 min-w-0 flex items-stretch gap-1">
        <HarnessField controls={controls} model={model} />
        {display.machineId ? (
          <MachineCapabilitiesRefreshButton
            chatroomId={chatroomId}
            machineId={display.machineId}
            daemonConnected={isDaemonConnected(daemonConnectivity, display.machineId)}
            linkedToChatroom={linkedMachineIds.has(display.machineId)}
          />
        ) : null}
      </div>
    </div>
  );
}

// ─── Working directory and hints ────────────────────────────────────

/** The working directory input, with a copy button once it has a value. */
function WorkingDirRow({ controls, model }: RowProps) {
  const { isBusy, isAgentRunning, handleWorkingDirChange } = controls;
  const value = model.display.workingDir;
  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={value}
        onChange={(e) => handleWorkingDirChange(e.target.value)}
        placeholder="/path/to/project"
        disabled={isBusy || isAgentRunning}
        className="flex-1 bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-mono text-chatroom-text-primary px-2 py-1.5 placeholder:text-chatroom-text-muted/50 focus:outline-none focus:border-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed"
        title="Working directory for agent (absolute path on remote machine)"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      />
      {value.trim() && (
        <CopyButton text={value.trim()} label="Copy Path" copiedLabel="Copied!" variant="compact" />
      )}
    </div>
  );
}

function SelectMachineHint({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="text-[10px] text-muted-foreground">Select a machine to start this agent.</p>;
}

// ─── Model, favourite, filter and actions ───────────────────────────

/** The model while an agent runs. It is read-only, and warns when the machine filter hides it. */
function ReadOnlyModelField({ model }: { model: RemoteTabModel }) {
  const { display, isSelectedModelHidden, modelUnavailable, modelFilter } = model;
  return (
    <div className="flex-1 min-w-0">
      <div
        className={cn(
          'w-full bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] font-bold uppercase tracking-wider text-chatroom-text-primary px-2 py-1.5 opacity-50 flex items-center justify-between',
          deriveModelWarning(modelUnavailable, isSelectedModelHidden) &&
            'text-chatroom-status-warning'
        )}
      >
        <span className="truncate">{runningModelText(modelUnavailable, display.model)}</span>
        {!modelUnavailable && (
          <ModelPickerMeta
            isSelectedModelHidden={isSelectedModelHidden}
            filter={modelFilter.filter}
          />
        )}
      </div>
    </div>
  );
}

/** The model: read-only while an agent runs, otherwise the picker. */
function ModelField({ controls, model }: RowProps) {
  if (controls.isAgentRunning) return <ReadOnlyModelField model={model} />;
  const { isBusy, availableModelsForHarness, handleModelChange } = controls;
  const { display, modelUnavailable } = model;
  return (
    <div className="flex-1 min-w-0">
      <ModelPickerField
        machineId={display.machineId}
        harness={display.harness}
        availableModels={availableModelsForHarness}
        value={modelPickerValue(modelUnavailable, display.model)}
        onValueChange={(m) => handleModelChange(m || null)}
        disabled={isBusy || modelUnavailable}
        triggerVariant="chatroom"
        allowDeselect={false}
        placeholder="Model..."
        className="gap-1"
      />
    </div>
  );
}

function FavoriteButton({
  entry,
  isFavorite,
  disabled,
  addFavorite,
  removeFavorite,
}: {
  entry: MachineConfigEntry;
  isFavorite: boolean;
  disabled: boolean;
  addFavorite: (entry: MachineConfigEntry) => void;
  removeFavorite: (entry: MachineConfigEntry) => void;
}) {
  const label = favoriteToggleLabel(isFavorite);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (isFavorite) {
          void removeFavorite(entry);
        } else {
          void addFavorite(entry);
        }
      }}
      aria-label={label}
      title={label}
      className="shrink-0 h-7 w-7 flex items-center justify-center text-chatroom-text-muted hover:text-chatroom-status-warning focus-visible:outline focus-visible:outline-2 focus-visible:outline-chatroom-accent disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Star
        size={14}
        className={isFavorite ? 'fill-chatroom-status-warning text-chatroom-status-warning' : ''}
      />
    </button>
  );
}

/** Favourite toggle for the current machine config. Hidden when there is no current config. */
function FavoriteSlot({ controls, model }: RowProps) {
  const entry = model.currentEntry;
  if (!showFavoriteToggle(model.display.machineId, entry) || !entry) return null;
  return (
    <FavoriteButton
      entry={entry}
      isFavorite={model.currentEntryIsFavorite}
      disabled={controls.isBusy}
      addFavorite={model.addFavorite}
      removeFavorite={model.removeFavorite}
    />
  );
}

function ModelFilterSlot({ controls, model }: RowProps) {
  const { display, modelFilter } = model;
  if (!showModelFilter(display.machineId, display.harness)) return null;
  return (
    <ModelFilterButton
      filter={modelFilter}
      availableModels={controls.availableModelsForHarness}
      disabled={controls.isBusy}
      variant="chatroom"
    />
  );
}

function SaveButton({
  canSave,
  isSaving,
  onSave,
}: {
  canSave: boolean;
  isSaving: boolean;
  onSave: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSave();
      }}
      disabled={!canSave}
      aria-label="Save Configuration"
      className={`${ACTION_BUTTON} ${
        canSave
          ? 'text-chatroom-status-info hover:bg-chatroom-status-info/10'
          : 'text-chatroom-text-muted cursor-not-allowed opacity-50'
      }`}
      title="Save configuration"
    >
      {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
    </button>
  );
}

function StopButton({ controls, stopFailed }: { controls: Controls; stopFailed: boolean }) {
  const { canStop, isStopping, handleStopAgent } = controls;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleStopAgent();
      }}
      disabled={!canStop}
      aria-busy={isStopping}
      aria-label={stopFailed ? 'Retry stopping agent' : 'Stop Agent'}
      className={`${ACTION_BUTTON} ${
        canStop
          ? 'text-chatroom-status-error hover:bg-chatroom-status-error/10'
          : 'text-chatroom-text-muted cursor-not-allowed opacity-50'
      }`}
      title="Stop Agent"
    >
      {isStopping ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
    </button>
  );
}

function RestartButton({ controls }: { controls: Controls }) {
  const { canRestart, isStarting, handleRestartAgent } = controls;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleRestartAgent();
      }}
      disabled={!canRestart}
      aria-label="Restart Agent"
      className={`${ACTION_BUTTON} ${
        canRestart
          ? 'text-chatroom-status-info hover:bg-chatroom-status-info/10'
          : 'text-chatroom-text-muted cursor-not-allowed opacity-50'
      }`}
      title="Restart Agent"
    >
      {isStarting ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
    </button>
  );
}

function StartButton({ controls }: { controls: Controls }) {
  const { canStart, isStarting, handleStartAgent } = controls;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleStartAgent();
      }}
      disabled={!canStart}
      aria-label="Start Agent"
      className={`${ACTION_BUTTON} ${
        canStart
          ? 'text-chatroom-status-success hover:bg-chatroom-status-success/10'
          : 'text-chatroom-text-muted cursor-not-allowed opacity-50'
      }`}
      title="Start Agent"
    >
      {isStarting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
    </button>
  );
}

/** Save, plus stop and restart while an agent runs, or start when it does not. */
function ActionButtons({ controls }: { controls: Controls }) {
  const { isAgentRunning, canSave, isSaving, stopFailed, handleSaveConfig } = controls;
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {!isAgentRunning && (
        <SaveButton canSave={canSave} isSaving={isSaving} onSave={() => void handleSaveConfig()} />
      )}
      {isAgentRunning ? (
        <>
          <StopButton controls={controls} stopFailed={stopFailed} />
          <RestartButton controls={controls} />
        </>
      ) : (
        <StartButton controls={controls} />
      )}
    </div>
  );
}

/** The model field, the favourite and filter buttons, and the action buttons, on one row. */
function ModelRow({ controls, model, setupMode }: RowProps & { setupMode: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <ModelField controls={controls} model={model} />
      </div>
      <FavoriteSlot controls={controls} model={model} />
      <ModelFilterSlot controls={controls} model={model} />
      {!setupMode && <ActionButtons controls={controls} />}
    </div>
  );
}

// ─── Status, quick pick and rehome dialog ───────────────────────────

function StatusLine({
  error,
  stopFailed,
  isStopping,
}: {
  error: string | null;
  stopFailed: boolean;
  isStopping: boolean;
}) {
  return (
    <div className="text-[10px]" aria-live="polite">
      {error ? (
        <p role="alert" className="text-chatroom-status-error">
          {error}
        </p>
      ) : stopFailed ? (
        <p role="alert" className="text-chatroom-status-error">
          Stop failed. Try again.
        </p>
      ) : isStopping ? (
        <p role="status" className="text-chatroom-text-secondary">
          Stopping…
        </p>
      ) : null}
    </div>
  );
}

/** Recommended and favourite configs for the machine. Hidden until a machine is shown. */
function QuickPickSlot({ controls, model }: RowProps) {
  const { display, favorites, recommended, addFavorite, removeFavorite, moveFavorite, isFavorite } =
    model;
  if (!display.machineId) return null;
  return (
    <MachineConfigQuickPick
      favorites={favorites}
      recommended={recommended}
      currentHarness={display.harness}
      currentModel={display.model}
      disabled={controls.isBusy}
      onApply={model.handleApplyMachineConfig}
      onToggleFavorite={(entry) => {
        if (isFavorite(entry)) {
          void removeFavorite(entry);
        } else {
          void addFavorite(entry);
        }
      }}
      onRemoveFavorite={(entry) => void removeFavorite(entry)}
      onMoveFavorite={(from, to) => void moveFavorite(from, to)}
      onDismissRecommended={model.handleDismissRecommended}
    />
  );
}

/** Confirms moving the role to another machine before a start. */
function RehomeDialog({ controls }: { controls: Controls }) {
  const {
    rehomeConfirmOpen,
    rehomeDialogLabels,
    handleCancelRehomeStart,
    handleConfirmRehomeStart,
  } = controls;
  return (
    <AlertDialog
      open={rehomeConfirmOpen}
      onOpenChange={(open) => {
        if (!open) handleCancelRehomeStart();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Move agent to another machine?</AlertDialogTitle>
          <AlertDialogDescription>
            {rehomeDialogLabels ? (
              <>
                Starting this agent will move the role from{' '}
                <span className="font-semibold text-chatroom-text-primary">
                  {rehomeDialogLabels.previous}
                </span>{' '}
                to{' '}
                <span className="font-semibold text-chatroom-text-primary">
                  {rehomeDialogLabels.next}
                </span>
                . Existing work on the old machine will continue until it exits. Continue?
              </>
            ) : (
              'Existing work on the old machine will continue until it exits. Continue?'
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancelRehomeStart}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirmRehomeStart}>Continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The controls shown once machines are known. */
export function RemoteTabBody({
  controls,
  model,
  connectedMachines,
  isLoadingMachines,
  setupMode,
  daemonConnectivity,
  chatroomId,
}: RowProps & {
  connectedMachines: MachineInfo[];
  isLoadingMachines: boolean;
  setupMode: boolean;
  daemonConnectivity?: Map<string, MachineConnectivity>;
  chatroomId: string;
}) {
  return (
    <>
      <MachineHarnessRow
        controls={controls}
        model={model}
        connectedMachines={connectedMachines}
        setupMode={setupMode}
        daemonConnectivity={daemonConnectivity}
        chatroomId={chatroomId}
      />
      {!setupMode && <WorkingDirRow controls={controls} model={model} />}
      <SelectMachineHint
        show={shouldShowSelectHint({
          setupMode,
          isAgentRunning: controls.isAgentRunning,
          selectedMachineId: controls.selectedMachineId,
          connectedCount: connectedMachines.length,
          isLoadingMachines,
        })}
      />
      <ModelRow controls={controls} model={model} setupMode={setupMode} />
      <StatusLine
        error={controls.error}
        stopFailed={controls.stopFailed}
        isStopping={controls.isStopping}
      />
      <QuickPickSlot controls={controls} model={model} />
      <RehomeDialog controls={controls} />
    </>
  );
}
