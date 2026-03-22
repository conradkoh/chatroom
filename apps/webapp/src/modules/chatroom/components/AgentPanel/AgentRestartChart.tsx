'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts';

// ─── Color palette for model bars ───────────────────────────────────────────

const MODEL_COLORS = [
  'var(--chatroom-status-info)',      // blue — adapts per mode
  'var(--chatroom-status-success)',   // green — adapts per mode
  'var(--chatroom-status-warning)',   // amber — adapts per mode
  'var(--chatroom-status-purple)',    // purple — adapts per mode
  'var(--chatroom-status-error)',     // red — adapts per mode
];

function getModelColor(index: number): string {
  return MODEL_COLORS[index % MODEL_COLORS.length];
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentRestartChartProps {
  machineId: string;
  chatroomId: string;
  /** The active role to display metrics for */
  role: string;
  /** Default model to pre-select (harness/model format, e.g. "pi/claude-sonnet-4-20250514") */
  defaultModel?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const SHORT_MONTH = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatDayLabel(date: Date): string {
  return `${SHORT_MONTH[date.getMonth()]} ${date.getDate()}`;
}

// ─── Custom Tooltip ──────────────────────────────────────────────────────────

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function RestartTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const total = payload.reduce((sum, entry) => sum + (entry.value ?? 0), 0);

  return (
    <div
      style={{
        backgroundColor: 'var(--chatroom-bg-primary)',
        border: '2px solid var(--chatroom-border-strong)',
        borderRadius: '0px',
        padding: '6px 8px',
      }}
    >
      <div
        style={{
          fontWeight: 'bold',
          fontSize: '9px',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--chatroom-text-muted)',
          marginBottom: '4px',
        }}
      >
        {label}
      </div>
      {/* Per-model breakdown */}
      {payload.map((entry) =>
        entry.value > 0 ? (
          <div
            key={entry.name}
            style={{
              fontSize: '10px',
              color: 'var(--chatroom-text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              marginBottom: '1px',
            }}
          >
            <div
              style={{
                width: '6px',
                height: '6px',
                backgroundColor: entry.color,
                borderRadius: '0px',
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{entry.name}</span>
            <span style={{ fontWeight: 600 }}>{entry.value}</span>
          </div>
        ) : null
      )}
      {/* Total row */}
      <div
        style={{
          borderTop: '2px solid var(--chatroom-border)',
          marginTop: '3px',
          paddingTop: '3px',
          fontSize: '10px',
          fontWeight: 'bold',
          color: 'var(--chatroom-text-primary)',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</span>
        <span>{total}</span>
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentRestartChart({
  machineId,
  chatroomId,
  role,
  defaultModel,
}: AgentRestartChartProps) {
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>({
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    end: new Date(),
  });
  const [selectedPreset, setSelectedPreset] = useState<'7d' | '30d' | 'custom'>('7d');

  const handlePreset = useCallback((preset: '7d' | '30d') => {
    const days = preset === '7d' ? 7 : 30;
    const now = new Date();
    setDateRange({ start: new Date(now.getTime() - days * 24 * 60 * 60 * 1000), end: now });
    setSelectedPreset(preset);
  }, []);

  const handleStartChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const parsed = new Date(e.target.value + 'T00:00:00');
      if (!isNaN(parsed.getTime())) {
        setDateRange((prev) => ({ ...prev, start: parsed }));
        setSelectedPreset('custom');
      }
    },
    []
  );

  const handleEndChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const parsed = new Date(e.target.value + 'T23:59:59');
      if (!isNaN(parsed.getTime())) {
        setDateRange((prev) => ({ ...prev, end: parsed }));
        setSelectedPreset('custom');
      }
    },
    []
  );

  const data = useSessionQuery(
    api.machines.getAgentRestartMetrics,
    role
      ? {
          machineId,
          role,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          startTime: dateRange.start.getTime(),
          endTime: dateRange.end.getTime(),
        }
      : 'skip'
  );

  // Aggregate hourly rows into daily buckets
  const { chartData, modelKeys } = useMemo(() => {
    if (!data || data.length === 0) return { chartData: [], modelKeys: [] };

    const modelSet = new Set<string>();
    const dayMap = new Map<string, { ts: number; byModel: Record<string, number> }>();

    for (const { hourBucket, byHarnessModel } of data) {
      const d = new Date(hourBucket);
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

      for (const key of Object.keys(byHarnessModel)) {
        modelSet.add(key);
      }

      const existing = dayMap.get(dayKey);
      if (existing) {
        for (const [key, count] of Object.entries(byHarnessModel)) {
          existing.byModel[key] = (existing.byModel[key] ?? 0) + count;
        }
      } else {
        const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        dayMap.set(dayKey, { ts: startOfDay, byModel: { ...byHarnessModel } });
      }
    }

    const modelKeys = Array.from(modelSet);

    const chartData = Array.from(dayMap.entries())
      .sort(([, a], [, b]) => a.ts - b.ts)
      .map(([, { ts, byModel }]) => {
        const _total = Object.values(byModel).reduce((sum, n) => sum + n, 0);
        return {
          day: formatDayLabel(new Date(ts)),
          _total,
          ...byModel,
        };
      });

    return { chartData, modelKeys };
  }, [data]);

  // Initialize selectedModels when data first loads
  useEffect(() => {
    if (modelKeys.length > 0 && !initializedRef.current) {
      initializedRef.current = true;
      if (defaultModel && modelKeys.includes(defaultModel)) {
        setSelectedModels(new Set([defaultModel]));
      } else {
        setSelectedModels(new Set(modelKeys));
      }
    }
  }, [modelKeys, defaultModel]);

  // Toggle a model in the selection
  const toggleModel = useCallback((model: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(model)) {
        // Don't allow deselecting the last one
        if (next.size > 1) next.delete(model);
      } else {
        next.add(model);
      }
      return next;
    });
  }, []);

  // Select/deselect all models
  const toggleAll = useCallback(() => {
    setSelectedModels((prev) => {
      if (prev.size === modelKeys.length) {
        // All selected → select only default or first
        return new Set([defaultModel && modelKeys.includes(defaultModel) ? defaultModel : modelKeys[0]]);
      }
      return new Set(modelKeys);
    });
  }, [modelKeys, defaultModel]);

  // Filter chart data to only include selected models
  const filteredModelKeys = useMemo(
    () => modelKeys.filter((m) => selectedModels.has(m)),
    [modelKeys, selectedModels]
  );

  const filteredChartData = useMemo(
    () =>
      chartData.map((day) => {
        const filtered: Record<string, unknown> = { day: day.day };
        let total = 0;
        for (const model of filteredModelKeys) {
          const val = (day as Record<string, unknown>)[model] as number ?? 0;
          filtered[model] = val;
          total += val;
        }
        filtered._total = total;
        return filtered;
      }),
    [chartData, filteredModelKeys]
  );

  const isEmpty = !data || data.length === 0 || chartData.length === 0;

  return (
    <div className="mt-2 space-y-1.5">
      {/* Control row: presets + date inputs */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <span className="text-[9px] font-bold uppercase tracking-widest text-chatroom-text-muted mr-1">
            Restarts
          </span>
          {(['7d', '30d'] as const).map((preset) => (
            <button
              key={preset}
              onClick={() => handlePreset(preset)}
              className={`text-[10px] font-medium px-1.5 py-0.5 transition-colors ${
                selectedPreset === preset
                  ? 'bg-accent/50 text-accent-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent/30'
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={formatDateInput(dateRange.start)}
            onChange={handleStartChange}
            className="bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] text-foreground px-1 py-0.5"
          />
          <span className="text-[9px] text-muted-foreground">–</span>
          <input
            type="date"
            value={formatDateInput(dateRange.end)}
            onChange={handleEndChange}
            className="bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] text-foreground px-1 py-0.5"
          />
        </div>
      </div>

      {/* Chart area */}
      {isEmpty ? (
        <div className="h-[120px] flex items-center justify-center">
          <p className="text-[10px] text-chatroom-text-muted">No restart data in selected range</p>
        </div>
      ) : (
        <div className="h-[120px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={filteredChartData} margin={{ top: 14, right: 4, left: -24, bottom: 0 }}>
              <XAxis
                dataKey="day"
                tick={{ fontSize: 9, fill: 'var(--chatroom-text-muted)' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 9, fill: 'var(--chatroom-text-muted)' }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                content={<RestartTooltip />}
                cursor={{ fill: 'var(--chatroom-bg-hover)', opacity: 0.4 }}
              />
              {filteredModelKeys.map((model, idx) => {
                const isTop = idx === filteredModelKeys.length - 1;
                const colorIdx = modelKeys.indexOf(model);
                return (
                  <Bar
                    key={model}
                    dataKey={model}
                    stackId="a"
                    fill={getModelColor(colorIdx)}
                    radius={[0, 0, 0, 0]}
                  >
                    <LabelList
                      dataKey={model}
                      position="inside"
                      style={{
                        fontSize: '8px',
                        fontWeight: 'bold',
                        fill: 'var(--chatroom-bg-primary)',
                      }}
                      formatter={(value: unknown) => (Number(value) > 0 ? String(value) : '')}
                    />
                    {/* Show total count above the topmost bar segment */}
                    {isTop && (
                      <LabelList
                        dataKey="_total"
                        position="top"
                        style={{
                          fontSize: '8px',
                          fontWeight: 'bold',
                          fill: 'var(--chatroom-text-muted)',
                        }}
                        formatter={(value: unknown) => (Number(value) > 0 ? String(value) : '')}
                      />
                    )}
                  </Bar>
                );
              })}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Model selector — clickable toggles */}
      {!isEmpty && modelKeys.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {modelKeys.length > 1 && (
            <button
              onClick={toggleAll}
              className="text-[9px] font-medium text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors mr-1"
            >
              {selectedModels.size === modelKeys.length ? 'Deselect all' : 'Select all'}
            </button>
          )}
          {modelKeys.map((model, idx) => {
            const isSelected = selectedModels.has(model);
            return (
              <button
                key={model}
                onClick={() => toggleModel(model)}
                className={`flex items-center gap-1 transition-opacity ${
                  isSelected ? 'opacity-100' : 'opacity-40'
                }`}
                title={isSelected ? `Hide ${model}` : `Show ${model}`}
              >
                <div
                  className="w-2.5 h-2.5 flex-shrink-0"
                  style={{ backgroundColor: getModelColor(idx) }}
                />
                <span className="text-[9px] text-chatroom-text-muted truncate max-w-[160px]">
                  {model}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
