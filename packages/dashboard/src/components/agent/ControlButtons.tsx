/**
 * Agent control buttons component.
 *
 * Provides Pause, Resume, and Run Once buttons that send commands
 * to the backend API. Button availability depends on the current
 * agent state.
 */

import type React from "react";
import { useState } from "react";
import { type AgentState, api } from "../../api/client";
import { cn } from "../../lib/utils";

/**
 * Props for the ControlButtons component.
 */
interface ControlButtonsProps {
	/** Current agent state, determines which buttons are active. */
	currentState: AgentState;
}

/**
 * Pause / Resume / Run Once control buttons for the agent.
 */
export function ControlButtons({ currentState }: ControlButtonsProps): React.ReactElement {
	const [loading, setLoading] = useState<string | null>(null);

	/**
	 * Execute a control action with loading state management.
	 */
	async function handleAction(action: "pause" | "resume" | "runOnce"): Promise<void> {
		setLoading(action);
		try {
			if (action === "pause") await api.control.pause();
			else if (action === "resume") await api.control.resume();
			else if (action === "runOnce") await api.control.runOnce();
		} catch (err: unknown) {
			console.error(`Failed to ${action}:`, err);
		} finally {
			setLoading(null);
		}
	}

	return (
		<div className="flex items-center gap-2">
			{/* Pause button — only when running */}
			<button
				type="button"
				onClick={() => void handleAction("pause")}
				disabled={currentState !== "running" || loading !== null}
				className={cn(
					"px-4 py-2 text-sm font-medium rounded-lg border transition-colors",
					currentState === "running"
						? "border-yellow-300 bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
						: "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed",
				)}
			>
				{loading === "pause" ? "Pausing..." : "Pause"}
			</button>

			{/* Resume button — only when paused */}
			<button
				type="button"
				onClick={() => void handleAction("resume")}
				disabled={currentState !== "paused" || loading !== null}
				className={cn(
					"px-4 py-2 text-sm font-medium rounded-lg border transition-colors",
					currentState === "paused"
						? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
						: "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed",
				)}
			>
				{loading === "resume" ? "Resuming..." : "Resume"}
			</button>

			{/* Run Once button — available when running or paused */}
			<button
				type="button"
				onClick={() => void handleAction("runOnce")}
				disabled={currentState === "stopped" || loading !== null}
				className={cn(
					"px-4 py-2 text-sm font-medium rounded-lg border transition-colors",
					currentState !== "stopped"
						? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
						: "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed",
				)}
			>
				{loading === "runOnce" ? "Running..." : "Run Once"}
			</button>
		</div>
	);
}
