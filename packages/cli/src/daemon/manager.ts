/**
 * Daemon process manager for the meta-ads-agent.
 *
 * Manages the lifecycle of the agent session: starting, stopping,
 * pausing, resuming, and querying status. Wires the AgentSession
 * (from @meta-ads-agent/core) to a real MetaClient and LLM provider,
 * and exposes the session through an IPC server for CLI/dashboard
 * control.
 *
 * The manager stores the PID and session metadata in
 * ~/.meta-ads-agent/daemon.json for cross-process coordination.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	AgentSession,
	AuditLogger,
	ClaudeProvider,
	DrizzleAuditDatabase,
	OpenAIProvider,
	ToolRegistry,
	allTools,
	createBudgetTools,
	createDatabase,
	loadConfig,
	parseInsightsToMetrics,
} from "@meta-ads-agent/core";
import type { AgentConfig, AgentGoal, CampaignMetrics, LLMProvider } from "@meta-ads-agent/core";
import { MetaClient } from "@meta-ads-agent/meta-client";
import { logger } from "../utils/logger.js";
import { IpcClient } from "./ipc.js";
import { IpcServer } from "./server.js";

/** Path to the daemon state file. */
const DAEMON_STATE_PATH = join(homedir(), ".meta-ads-agent", "daemon.json");

/** Default socket path mirrored from server.ts -- chmod-tightened on creation. */
const DEFAULT_SOCKET_PATH = join(homedir(), ".meta-ads-agent", "agent.sock");

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
	success: boolean;
	actionsCount: number;
	durationMs: number;
	decisions: Array<{ toolName: string; action: string }>;
	error?: string;
}

/**
 * Snapshot of the current agent status.
 */
export interface AgentStatus {
	state: "running" | "paused" | "stopped" | "error" | "idle";
	sessionId: string | null;
	startedAt: string | null;
	lastTickAt: string | null;
	nextTickAt: string | null;
	tickCount: number;
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
	current: MetricsSummary;
	previous: MetricsSummary;
	campaigns: Array<{
		name: string;
		status: string;
		spend: number;
		roas: number;
		cpa: number;
	}>;
}

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
 * Builds an LLMProvider based on the loaded agent config.
 */
function buildLlmProvider(config: AgentConfig): LLMProvider {
	if (config.llmProvider === "openai") {
		if (!config.openaiApiKey) {
			throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER=openai");
		}
		return new OpenAIProvider({
			apiKey: config.openaiApiKey,
			model: config.llmModel,
		});
	}
	if (!config.anthropicApiKey) {
		throw new Error("ANTHROPIC_API_KEY is required when LLM_PROVIDER=claude");
	}
	return new ClaudeProvider({
		apiKey: config.anthropicApiKey,
		model: config.llmModel,
	});
}

/**
 * Manages the agent daemon lifecycle.
 *
 * When the agent runs as a long-lived process, the DaemonManager
 * coordinates start/stop/pause/resume via IPC.
 */
export class DaemonManager {
	private readonly ipc: IpcClient;
	private ipcServer: IpcServer | null = null;
	private session: AgentSession | null = null;
	private dbConnection: ReturnType<typeof createDatabase> | null = null;
	private currentSessionId: string | null = null;
	private currentStartedAt: string | null = null;

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
	 *
	 * Wires up the full agent stack (config -> MetaClient -> LLM ->
	 * ToolRegistry -> AgentSession), records the daemon state on disk,
	 * then begins scheduled OODA ticks.
	 */
	async start(options: StartOptions): Promise<void> {
		logger.debug("Starting daemon with options: %o", options);

		/* ---- Load + validate configuration ---- */
		const baseConfig = loadConfig();
		const tickIntervalMs = options.intervalMinutes * 60 * 1000;
		const config: AgentConfig = {
			...baseConfig,
			tickIntervalMs,
			dryRun: options.dryRun || baseConfig.dryRun,
		};

		/* ---- Build MetaClient and validate auth ---- */
		const metaClient = new MetaClient({
			accessToken: config.metaAccessToken,
			adAccountId: config.metaAdAccountId,
		});
		await metaClient.initialize();

		/* ---- Build LLM provider ---- */
		const llmProvider = buildLlmProvider(config);

		/* ---- Set up database + audit logger ---- */
		this.dbConnection = createDatabase({
			type: config.dbType,
			sqlitePath: config.sqlitePath,
			postgresUrl: config.postgresUrl,
		});
		const auditDb = new DrizzleAuditDatabase(this.dbConnection.db);
		const auditLogger = new AuditLogger(auditDb);

		/* ---- Build the tool registry: static tools + budget tools bound to client ---- */
		const goals: AgentGoal = {
			roasTarget: 3.0,
			cpaCap: 50,
			dailyBudgetLimit: 10_000,
			riskLevel: "moderate",
		};

		const registry = new ToolRegistry();
		const boundBudgetTools = createBudgetTools(metaClient, goals);
		const seen = new Set<string>();
		for (const tool of [...allTools, ...boundBudgetTools]) {
			if (seen.has(tool.name)) continue;
			seen.add(tool.name);
			registry.register(tool);
		}

		/* ---- fetchMetrics: pulls fresh insights from Meta ---- */
		const fetchMetrics = async (): Promise<CampaignMetrics[]> => {
			const insights = await metaClient.insights.query(config.metaAdAccountId, {
				level: "campaign",
				date_preset: "today",
				fields: [
					"campaign_id",
					"impressions",
					"clicks",
					"spend",
					"ctr",
					"actions",
					"action_values",
					"date_start",
				],
			});
			return insights
				.filter((i) => Boolean(i.campaign_id))
				.map((i) => {
					const m = parseInsightsToMetrics(i);
					return {
						campaignId: i.campaign_id ?? "",
						impressions: m.impressions,
						clicks: m.clicks,
						spend: m.spend,
						conversions: m.conversions,
						roas: m.roas,
						cpa: m.cpa,
						ctr: m.ctr,
						date: i.date_start ?? new Date().toISOString().slice(0, 10),
					};
				});
		};

		/* ---- Construct + start the session ---- */
		this.session = new AgentSession({
			config,
			toolRegistry: registry,
			llmProvider,
			auditLogger,
			goals,
			fetchMetrics,
			metaClient,
		});

		this.currentSessionId = this.session.getStatus().sessionId;
		this.currentStartedAt = new Date().toISOString();

		const state: DaemonState = {
			pid: process.pid,
			sessionId: this.currentSessionId,
			startedAt: this.currentStartedAt,
			intervalMinutes: options.intervalMinutes,
		};
		this.writeState(state);

		/* ---- Wire IPC handlers to the live session ---- */
		this.ipcServer = new IpcServer();
		this.registerIpcHandlers();
		await this.ipcServer.start();
		this.tightenSocketPermissions();

		/* ---- Begin scheduled OODA ticks ---- */
		await this.session.start();
	}

	/**
	 * Wires IPC method handlers to the running session.
	 */
	private registerIpcHandlers(): void {
		if (!this.ipcServer) return;
		const server = this.ipcServer;

		server.on("status", async () => {
			if (!this.session) {
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
			const s = this.session.getStatus();
			return {
				state: s.state,
				sessionId: s.sessionId,
				startedAt: this.currentStartedAt,
				lastTickAt: s.lastTickAt,
				nextTickAt: s.nextTickAt,
				tickCount: s.iterationCount,
				recentDecisions: [],
			};
		});

		server.on("pause", async () => {
			logger.info("Agent paused via IPC");
			await this.session?.stop();
			return { success: true };
		});

		server.on("resume", async () => {
			logger.info("Agent resumed via IPC");
			await this.session?.start();
			return { success: true };
		});

		server.on("stop", async () => {
			logger.info("Agent stopping via IPC");
			void this.stop();
			return { success: true };
		});

		server.on("run-once", async () => {
			if (!this.session) {
				return { success: false, actionsCount: 0, durationMs: 0, decisions: [] };
			}
			const start = Date.now();
			const result = await this.session.runOnce();
			return {
				success: result.success,
				actionsCount: result.executedActions.length,
				durationMs: Date.now() - start,
				decisions: result.executedActions.map((a) => ({
					toolName: a.toolName,
					action: a.reasoning ?? "",
				})),
				error: result.error ?? undefined,
			};
		});

		server.on("get-decisions", async () => []);
		server.on("get-campaigns", async () => []);
	}

	/**
	 * Apply 0o600 to the socket file so only the owner can connect.
	 */
	private tightenSocketPermissions(): void {
		try {
			if (existsSync(DEFAULT_SOCKET_PATH)) {
				chmodSync(DEFAULT_SOCKET_PATH, 0o600);
			}
		} catch (err: unknown) {
			logger.debug("Failed to chmod socket: %s", (err as Error).message);
		}
	}

	/**
	 * Stop the running agent daemon gracefully.
	 */
	async stop(): Promise<void> {
		logger.debug("Stopping daemon...");
		if (this.session) {
			await this.session.stop();
			this.session = null;
		}
		if (this.ipcServer) {
			await this.ipcServer.stop();
			this.ipcServer = null;
		}
		if (this.dbConnection) {
			try {
				this.dbConnection.close();
			} catch {
				/* swallow */
			}
			this.dbConnection = null;
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
	 * Write daemon state to disk with secure permissions.
	 */
	private writeState(state: DaemonState): void {
		const dir = dirname(DAEMON_STATE_PATH);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
		/* If the file exists with looser perms, remove it first so that 0o600 takes effect. */
		try {
			if (existsSync(DAEMON_STATE_PATH)) unlinkSync(DAEMON_STATE_PATH);
		} catch {
			/* ignore */
		}
		writeFileSync(DAEMON_STATE_PATH, JSON.stringify(state, null, 2), {
			encoding: "utf-8",
			mode: 0o600,
		});
		try {
			chmodSync(DAEMON_STATE_PATH, 0o600);
		} catch {
			/* best effort */
		}
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
