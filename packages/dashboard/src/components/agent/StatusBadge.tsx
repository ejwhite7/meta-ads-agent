/**
 * Agent status badge component.
 *
 * Displays the current agent lifecycle state (running, paused, stopped)
 * with a color-coded indicator and optional uptime display.
 */

import type React from "react";
import type { AgentState } from "../../api/client";
import { cn } from "../../lib/utils";

/**
 * Props for the StatusBadge component.
 */
interface StatusBadgeProps {
	/** Current agent state. */
	state: AgentState;
	/** Uptime in seconds (displayed for running/paused states). */
	uptime?: number;
}

/**
 * Color and label mapping for each agent state.
 */
const STATE_CONFIG: Record<AgentState, { color: string; bgColor: string; label: string }> = {
	running: { color: "text-green-700", bgColor: "bg-green-100", label: "Running" },
	paused: { color: "text-yellow-700", bgColor: "bg-yellow-100", label: "Paused" },
	stopped: { color: "text-gray-700", bgColor: "bg-gray-100", label: "Stopped" },
};

/**
 * Format seconds into a human-readable duration (e.g. "2h 15m").
 */
function formatDuration(seconds: number): string {
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m`;
	return `${seconds}s`;
}

/**
 * Visual badge showing agent state with optional uptime.
 */
export function StatusBadge({ state, uptime }: StatusBadgeProps): React.ReactElement {
	const config = STATE_CONFIG[state];

	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium",
				config.bgColor,
				config.color,
			)}
		>
			<span
				className={cn("w-2 h-2 rounded-full", {
					"bg-green-500 animate-pulse": state === "running",
					"bg-yellow-500": state === "paused",
					"bg-gray-400": state === "stopped",
				})}
			/>
			{config.label}
			{uptime !== undefined && uptime > 0 && (
				<span className="text-xs opacity-75">({formatDuration(uptime)})</span>
			)}
		</span>
	);
}
