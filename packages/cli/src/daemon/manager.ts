/**
 * Daemon process manager for the meta-ads-agent.
 *
 * Manages the lifecycle of the agent session: starting, stopping,
 * pausing, resuming, and querying status. Communicates with the
 * core AgentSession through the IPC channel when running as a
 * background daemon, or directly when running in the foreground.
 *
 * The manager stores the PID and session metadata in
 * ~/.meta-ads-agent/daemon.json for cross-process coordination.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "../utils/logger.js";
import { IpcClient } from "./ipc.js";
import { IpcServer } from "./server.js";

/** Path to the daemon state file. */
const DAEMON_STATE_PATH = join(homedir(), ".meta-ads-agent", "daemon.json");

/**
 * Options for starting a new agent session.
 */
export interface StartOptions {
	/** Interval between ticks in minutes. */
	intervalMinutes: number;
	/** Maximum number of ticks (Infinity for unlimited). */
	maxTicks: number;
	/** Whether to run in dry-run mode (no real API calls). */
	dryRun: boolean;
}

/**
 * Result of a single-tick execution.
 */
export interface TickResult {
	/** Whether the tick completed without errors. */
	success: boolean;
	/** Number of tool actions invoked during the tick. */
	actionsCount: number;
	/** Duration of the tick in milliseconds. */
	durationMs: number;
	/** Summary of decisions made during the tick. */
	decisions: Array<{ toolName: string; action: string }>;
	/** Error message if the tick failed. */
	error?: string;
}

/**
 * Snapshot of the current agent status.
 */
export interface AgentStatus {
	/** Current agent lifecycle state. */
	state: "running" | "paused" | "stopped";
	/** Active session identifier, if any. */
	sessionId: string | null;
	/** ISO timestamp when the session started. */
	startedAt: string | null;
	/** ISO timestamp of the last completed tick. */
	lastTickAt: string | null;
	/** ISO timestamp of the next scheduled tick. */
	nextTickAt: string | null;
	/** Total number of ticks completed in this session. */
	tickCount: number;
	/** The 5 most recent decisions. */
	recentDecisions: Array<{
		timestamp: string;
		toolName: string;
		action: string;
		status: string;
	}>;
}

/**
 * Performance report for a date range.
 */
export interface PerformanceReport {
	/** Metrics for the requested period. */
	current: MetricsSummary;
	/** Metrics for the prior period of equal length. */
	previous: MetricsSummary;
	/** Per-campaign breakdown. */
	campaigns: Array<{
		name: string;
		status: string;
		spend: number;
		roas: number;
		cpa: number;
	}>;
}

/**
 * Aggregated performance metrics.
 */
interface MetricsSummary {
	spend: number;
	impressions: number;
	clicks: number;
	conversions: number;
	roas: number;
	cpa: number;
	cpc: number;
}

/**
 * Persistent state written to daemon.json for cross-process coordination.
 */
interface DaemonState {
	pid: number;
	sessionId: string;
	startedAt: string;
	intervalMinutes: number;
}

/**
 * Manages the agent daemon lifecycle.
 *
 * When the agent runs as a long-lived process, the DaemonManager
 * coordinates start/stop/pause/resume via IPC. For single-tick
 * operations, it invokes the core library directly.
 */
export class DaemonManager {
	private readonly ipc: IpcClient;
	private ipcServer: IpcServer | null = null;

	constructor() {
		this.ipc = new IpcClient();
	}

	/**
	 * Check whether an agent daemon is currently running.
	 */
	async isRunning(): Promise<boolean> {
		const state = this.readState();
		if (!state) return false;

		try {
			process.kill(state.pid, 0);
			return true;
		} catch {
			this.clearState();
			return false;
		}
	}

	/**
	 * Start the agent daemon with the given options.
	 */
	async start(options: StartOptions): Promise<void> {
		logger.debug("Starting daemon with options: %o", options);

		const sessionId = `session_${Date.now()}`;
		const state: DaemonState = {
			pid: process.pid,
			sessionId,
			startedAt: new Date().toISOString(),
			intervalMinutes: options.intervalMinutes,
		};

		this.writeState(state);

		/* Start the IPC server so CLI and dashboard can communicate */
		this.ipcServer = new IpcServer();

		this.ipcServer.on("status", async () => ({
			state: "running" as const,
			sessionId,
			startedAt: state.startedAt,
			lastTickAt: null,
			nextTickAt: null,
			tickCount: 0,
			recentDecisions: [],
		}));

		this.ipcServer.on("pause", async () => {
			logger.info("Agent paused via IPC");
			return { success: true };
		});

		this.ipcServer.on("resume", async () => {
			logger.info("Agent resumed via IPC");
			return { success: true };
		});

		this.ipcServer.on("stop", async () => {
			logger.info("Agent stopping via IPC");
			void this.stop();
			return { success: true };
		});

		this.ipcServer.on("run-once", async () => ({
			success: true,
			actionsCount: 0,
			durationMs: 0,
			decisions: [],
		}));

		this.ipcServer.on("get-decisions", async () => []);
		this.ipcServer.on("get-campaigns", async () => []);

		await this.ipcServer.start();
	}

	/**
	 * Stop the running agent daemon gracefully.
	 */
	async stop(): Promise<void> {
		logger.debug("Stopping daemon...");
		if (this.ipcServer) {
			await this.ipcServer.stop();
			this.ipcServer = null;
		}
		this.clearState();
	}

	/**
	 * Pause the running agent daemon.
	 */
	async pause(): Promise<void> {
		await this.ipc.send("pause", {});
	}

	/**
	 * Resume a paused agent daemon.
	 */
	async resume(): Promise<void> {
		await this.ipc.send("resume", {});
	}

	/**
	 * Execute a single tick without starting a persistent daemon.
	 */
	async runOnce(options: { dryRun: boolean }): Promise<TickResult> {
		const response = await this.ipc.send("run-once", options);
		return response as TickResult;
	}

	/**
	 * Retrieve the current agent status.
	 */
	async getStatus(): Promise<AgentStatus> {
		const running = await this.isRunning();

		if (!running) {
			return {
				state: "stopped",
				sessionId: null,
				startedAt: null,
				lastTickAt: null,
				nextTickAt: null,
				tickCount: 0,
				recentDecisions: [],
			};
		}

		const response = await this.ipc.send("status", {});
		return response as AgentStatus;
	}

	/**
	 * Generate a performance report for the given number of days.
	 */
	async getReport(days: number): Promise<PerformanceReport> {
		const response = await this.ipc.send("report", { days });
		return response as PerformanceReport;
	}

	/**
	 * Read the persisted daemon state file.
	 */
	private readState(): DaemonState | null {
		if (!existsSync(DAEMON_STATE_PATH)) return null;
		try {
			const raw = readFileSync(DAEMON_STATE_PATH, "utf-8");
			return JSON.parse(raw) as DaemonState;
		} catch {
			return null;
		}
	}

	/**
	 * Write daemon state to disk.
	 */
	private writeState(state: DaemonState): void {
		writeFileSync(DAEMON_STATE_PATH, JSON.stringify(state, null, 2), {
			encoding: "utf-8",
			mode: 0o600,
		});
	}

	/**
	 * Remove the daemon state file.
	 */
	private clearState(): void {
		try {
			unlinkSync(DAEMON_STATE_PATH);
		} catch {
			// File may already be deleted.
		}
	}
}
