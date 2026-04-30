/**
 * Decision card component.
 *
 * Displays a single agent decision with timestamp, tool name badge,
 * action summary, expandable LLM reasoning, and outcome status.
 * Color-coded: green for executed, red for failed, yellow for pending.
 */

import React, { useState } from "react";
import { cn } from "../../lib/utils";
import type { AuditRecord } from "../../api/client";

/**
 * Props for the DecisionCard component.
 */
interface DecisionCardProps {
  /** The audit record to display. */
  decision: AuditRecord;
}

/**
 * Status color mapping for decision cards.
 */
const STATUS_STYLES: Record<string, { border: string; badge: string }> = {
  executed: {
    border: "border-l-green-500",
    badge: "bg-green-100 text-green-800",
  },
  failed: {
    border: "border-l-red-500",
    badge: "bg-red-100 text-red-800",
  },
  pending: {
    border: "border-l-yellow-500",
    badge: "bg-yellow-100 text-yellow-800",
  },
  skipped: {
    border: "border-l-gray-400",
    badge: "bg-gray-100 text-gray-800",
  },
};

/**
 * Card displaying a single agent decision with expandable reasoning.
 */
export function DecisionCard({ decision }: DecisionCardProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const styles = STATUS_STYLES[decision.status] ?? STATUS_STYLES.skipped;

  return (
    <div
      className={cn(
        "border border-gray-200 border-l-4 rounded-lg p-4",
        styles.border,
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {/* Tool badge */}
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            {decision.toolName}
          </span>
          {/* Timestamp */}
          <span className="text-xs text-gray-500">
            {new Date(decision.timestamp).toLocaleString()}
          </span>
        </div>
        {/* Status badge */}
        <span
          className={cn(
            "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
            styles.badge,
          )}
        >
          {decision.status}
        </span>
      </div>

      {/* Action summary */}
      <p className="mt-2 text-sm text-gray-700">
        {JSON.stringify(decision.toolParams)}
      </p>

      {/* Expandable reasoning */}
      {decision.llmReasoning && (
        <div className="mt-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
          >
            {expanded ? "Hide reasoning" : "Show reasoning"}
          </button>
          {expanded && (
            <p className="mt-1 text-sm text-gray-600 bg-gray-50 rounded p-2">
              {decision.llmReasoning}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
