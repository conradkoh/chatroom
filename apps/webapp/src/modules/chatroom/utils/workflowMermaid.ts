/**
 * Shared Mermaid chart utilities for workflow visualization.
 *
 * Used by both WorkflowVisualizer (modal with status styling) and
 * workflowEvents (event stream inline previews).
 */

// ─── Types ──────────────────────────────────────────────────────────

/** Minimal step shape required for Mermaid chart generation. */
export interface MermaidWorkflowStep {
  stepKey: string;
  description: string;
  assigneeRole?: string;
  dependsOn: string[];
}

/** Optional status field for status-styled charts. */
export interface MermaidWorkflowStepWithStatus extends MermaidWorkflowStep {
  status: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Sanitize text for use in Mermaid node labels.
 * Escapes backslashes and replaces double quotes with single quotes
 * to prevent Mermaid parse errors.
 */
export function sanitizeMermaidLabel(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, "'");
}

/** Status → Mermaid node fill style (inline CSS for SVG nodes). */
function getStatusStyle(status: string): string {
  switch (status) {
    case 'pending':
      return 'fill:#6b7280,stroke:#4b5563,color:#fff';
    case 'in_progress':
      return 'fill:#3b82f6,stroke:#2563eb,color:#fff';
    case 'completed':
      return 'fill:#22c55e,stroke:#16a34a,color:#fff';
    case 'cancelled':
      return 'fill:#ef4444,stroke:#dc2626,color:#fff';
    default:
      return 'fill:#6b7280,stroke:#4b5563,color:#fff';
  }
}

// ─── Chart Builders ─────────────────────────────────────────────────

/**
 * Build a Mermaid flowchart definition from workflow steps.
 * Renders nodes (with key, description, optional assignee) and dependency edges.
 *
 * Does NOT include status styling — use `buildWorkflowChartWithStatus` for that.
 */
export function buildWorkflowMermaid(steps: MermaidWorkflowStep[]): string {
  const lines: string[] = ['flowchart TD'];

  for (const step of steps) {
    const desc = sanitizeMermaidLabel(step.description);
    const role = step.assigneeRole ? sanitizeMermaidLabel(step.assigneeRole) : null;
    const label = role
      ? `${step.stepKey}\\n${desc}\\n[${role}]`
      : `${step.stepKey}\\n${desc}`;
    lines.push(`  ${step.stepKey}["${label}"]`);
  }

  for (const step of steps) {
    for (const dep of step.dependsOn) {
      lines.push(`  ${dep} --> ${step.stepKey}`);
    }
  }

  return lines.join('\n');
}

/**
 * Build a Mermaid flowchart with status-based node styling.
 * Extends the base chart with inline fill/stroke styles per status.
 *
 * Used by WorkflowVisualizer where step status is available.
 */
export function buildWorkflowChartWithStatus(steps: MermaidWorkflowStepWithStatus[]): string {
  const base = buildWorkflowMermaid(steps);
  const styleLines: string[] = [];

  for (const step of steps) {
    const style = getStatusStyle(step.status);
    styleLines.push(`  style ${step.stepKey} ${style}`);
  }

  return styleLines.length > 0 ? `${base}\n${styleLines.join('\n')}` : base;
}
