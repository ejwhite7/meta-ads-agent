/**
 * Typed API client for the meta-ads-agent Hono backend.
 *
 * All requests include the X-API-Key header for authentication
 * and expect JSON responses. Non-2xx responses throw typed errors.
 */

import { API_BASE_URL } from "../lib/constants";

/**
 * Agent lifecycle states.
 */
export type AgentState = "running" | "paused" | "stopped";

/**
 * Current agent status returned by GET /api/status.
 */
export interface AgentStatus {
	state: AgentState;
	sessionId: string | null;
	startedAt: string | null;
	lastTickAt: string | null;
	nextTickAt: string | null;
	tickCount: number;
	uptime: number;
}

/**
 * Derived UI-facing status for a decision row. Computed client-side
 * from the raw {@link AuditRecord} fields -- the backend stores only
 * `success: boolean` and an `expectedOutcome` string. There's no
 * persisted `status` enum to read.
 */
export type DecisionStatus = "pending" | "executed" | "failed" | "resolved";

/**
 * A single audit record from the agent decision log.
 *
 * Field shape MUST match `AuditRecord` in @meta-ads-agent/core
 * (packages/core/src/audit/types.ts) since the dashboard server
 * returns Drizzle rows verbatim. Earlier versions of this file used
 * an aspirational shape (`llmReasoning`, `toolParams`, `status`,
 * `inputMetrics`, etc.) that didn't match reality, and the entire
 * Decisions tab crashed on first render with `Cannot read properties
 * of undefined (reading 'length')`.
 */
export interface AuditRecord {
	id: string;
	timestamp: string;
	sessionId: string;
	adAccountId: string;
	toolName: string;
	/** JSON-serialized tool parameters. The backend stores TEXT; parse if you need an object. */
	params: string;
	reasoning: string;
	expectedOutcome: string;
	score: number;
	riskLevel: "low" | "medium" | "high";
	success: boolean;
	resultData: string | null;
	errorMessage: string | null;
	/**
	 * Set by the backend on `_pending_guidance` rows when an active
	 * goal now exists for the same campaign (and matches the row's
	 * objective). Lets the UI render those rows in grey “since
	 * resolved” instead of red “failed.” The row itself is unchanged —
	 * the audit log is append-only — we just decorate the response.
	 */
	resolved?: boolean;
	resolvedByGoalDbId?: number;
	resolvedAt?: string;
}

/**
 * Derives a UI-facing status from the raw audit fields.
 *
 *   PENDING_HUMAN_APPROVAL  -> "pending"
 *   success === true        -> "executed"
 *   success === false       -> "failed"
 */
export function decisionStatus(d: AuditRecord): DecisionStatus {
	if (d.expectedOutcome === "PENDING_HUMAN_APPROVAL") return "pending";
	/* `_pending_guidance` rows that have since been addressed (an active
	 * goal now exists) render as "resolved" — grey, not red — so the
	 * operator isn't misled by stale red rows after configuring goals. */
	if (d.resolved === true) return "resolved";
	return d.success ? "executed" : "failed";
}

/**
 * Safely parses the JSON-encoded `params` string. Returns an empty
 * object on parse failure so the UI never throws on a malformed row.
 */
export function decisionParams(d: AuditRecord): Record<string, unknown> {
	try {
		const parsed = JSON.parse(d.params);
		return typeof parsed === "object" && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}

/**
 * Filter parameters for the decisions endpoint.
 *
 * NOTE: `status` and `search` are applied client-side; the backend
 * `/api/decisions` endpoint currently only honors `limit`/`offset`.
 * Server-side filter support is tracked separately.
 */
export interface DecisionFilter {
	status?: DecisionStatus | "all";
	search?: string;
	limit?: number;
	offset?: number;
	/** ISO 8601 timestamps; sent server-side as startDate/endDate. */
	startDate?: string;
	endDate?: string;
}

/**
 * Per-campaign goal — mirror of `CampaignGoal` in @meta-ads-agent/core
 * (packages/core/src/goals/types.ts). Field names + types must match
 * what the backend returns verbatim.
 */
export type PrimaryKpi =
	| "roas"
	| "cpa"
	| "cpl"
	| "cpc"
	| "ctr"
	| "cpm"
	| "cpi"
	| "cost_per_thruplay"
	| "thruplay_rate"
	| "frequency"
	| "reach";

export type KpiDirection = "maximize" | "minimize";

export interface SecondaryKpi {
	kpi: PrimaryKpi;
	target?: number;
	direction?: KpiDirection;
}

export interface CampaignGoal {
	dbId: number;
	adAccountId: string;
	campaignId: string;
	primaryKpi: PrimaryKpi;
	primaryKpiTarget: number;
	primaryKpiDirection: KpiDirection;
	secondaryKpis: SecondaryKpi[];
	minDailyBudget: number | null;
	maxBudgetScaleFactor: number | null;
	requireApprovalAbove: number | null;
	lastSeenObjective: string;
	configuredAt: string;
	configuredBy: string;
	notes: string | null;
	deletedAt: string | null;
}

/**
 * A campaign that needs operator attention before the agent will act.
 * Mirrors `PendingGuidance` in @meta-ads-agent/core.
 */
export type PendingGuidanceReason =
	| "no_goal_configured"
	| "objective_changed"
	| "goal_explicitly_reset";

export interface PendingGuidance {
	campaignId: string;
	campaignName: string;
	currentObjective: string;
	status: string;
	dailyBudget: number | null;
	reason: PendingGuidanceReason;
	previousObjective?: string;
	previousGoalDbId?: number;
}

/**
 * Default goal suggestion returned by `GET /api/goals/defaults`.
 * Mirrors `DefaultGoal` in @meta-ads-agent/core.
 */
export interface DefaultGoal {
	primaryKpi: PrimaryKpi;
	primaryKpiTarget: number;
	primaryKpiDirection: KpiDirection;
	promptLabel: string;
	currency: boolean;
}

/**
 * Body for `POST /api/goals`. The backend stamps `adAccountId`
 * (always the configured account) and `configuredBy: "dashboard"`.
 */
export interface CampaignGoalUpsert {
	campaignId: string;
	primaryKpi: PrimaryKpi;
	primaryKpiTarget: number;
	primaryKpiDirection: KpiDirection;
	lastSeenObjective: string;
	secondaryKpis?: SecondaryKpi[];
	minDailyBudget?: number | null;
	maxBudgetScaleFactor?: number | null;
	requireApprovalAbove?: number | null;
	notes?: string;
}

/**
 * Hierarchical campaign view returned by `GET /api/campaigns`.
 *
 * Lookback window (default 7d) is controlled by the
 * `META_ADS_AGENT_DATE_PRESET` env var on the dashboard server. The
 * field names use a `7d` suffix because that's the default and what
 * existing UI assumed; the actual window is whatever the server
 * configured.
 */
export interface AdMetricsRow {
	id: string;
	name: string;
	status: string;
	spend7d: number;
	roas7d: number;
	cpa7d: number;
	impressions7d: number;
	clicks7d: number;
	conversions7d: number;
}

export interface AdSetMetricsRow {
	id: string;
	name: string;
	status: string;
	dailyBudget: number;
	spend7d: number;
	roas7d: number;
	cpa7d: number;
	impressions7d: number;
	clicks7d: number;
	conversions7d: number;
	ads: AdMetricsRow[];
}

export interface CampaignMetrics {
	id: string;
	name: string;
	status: string;
	objective: string;
	dailyBudget: number;
	spend7d: number;
	roas7d: number;
	cpa7d: number;
	impressions7d: number;
	clicks7d: number;
	conversions7d: number;
	/** Active goal for this campaign, or null if none configured. */
	goal: CampaignGoal | null;
	adSets: AdSetMetricsRow[];
}

/**
 * API error with status code and structured message.
 */
export class ApiError extends Error {
	public readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

/**
 * Retrieve the API key from environment or local storage.
 */
function getApiKey(): string {
	if (typeof window !== "undefined") {
		return localStorage.getItem("meta-ads-agent-api-key") ?? "";
	}
	return "";
}

/**
 * Make an authenticated JSON request to the API.
 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const url = `${API_BASE_URL}${path}`;
	const apiKey = getApiKey();

	const response = await fetch(url, {
		...options,
		headers: {
			"Content-Type": "application/json",
			"X-API-Key": apiKey,
			...options?.headers,
		},
	});

	if (!response.ok) {
		const body = await response.text();
		throw new ApiError(response.status, body || response.statusText);
	}

	if (response.status === 204) {
		return undefined as T;
	}

	return response.json() as Promise<T>;
}

/**
 * Typed API client for the meta-ads-agent backend.
 *
 * Usage:
 * ```typescript
 * const status = await api.getStatus();
 * const decisions = await api.getDecisions({ status: "executed", limit: 10 });
 * await api.control.pause();
 * ```
 */
export const api = {
	/**
	 * Fetch the current agent status.
	 */
	getStatus(): Promise<AgentStatus> {
		return request<AgentStatus>("/api/status");
	},

	/**
	 * Fetch the agent decision log.
	 *
	 * `limit`/`offset`/`startDate`/`endDate` are sent to the server.
	 * `status`/`search` are applied client-side because the backend
	 * doesn't yet honor them.
	 */
	getDecisions(filter?: DecisionFilter): Promise<AuditRecord[]> {
		const params = new URLSearchParams();
		if (filter?.limit) params.set("limit", String(filter.limit));
		if (filter?.offset) params.set("offset", String(filter.offset));
		if (filter?.startDate) params.set("startDate", filter.startDate);
		if (filter?.endDate) params.set("endDate", filter.endDate);

		const qs = params.toString();
		return request<AuditRecord[]>(`/api/decisions${qs ? `?${qs}` : ""}`);
	},

	/**
	 * Fetch campaign performance metrics.
	 */
	getCampaigns(): Promise<CampaignMetrics[]> {
		return request<CampaignMetrics[]>("/api/campaigns");
	},

	/**
	 * Per-campaign goal management.
	 *
	 * `pending` hits the live Marketing API and may return 502 if the
	 * configured token is invalid. The other endpoints read/write only
	 * the local SQLite audit DB.
	 */
	goals: {
		/** List every active (non-soft-deleted) goal in the account. */
		list(): Promise<CampaignGoal[]> {
			return request<CampaignGoal[]>("/api/goals");
		},

		/** Fetch the active goal for one campaign, or null if none. */
		async get(campaignId: string): Promise<CampaignGoal | null> {
			try {
				return await request<CampaignGoal>(`/api/goals/${encodeURIComponent(campaignId)}`);
			} catch (err) {
				if (err instanceof ApiError && err.status === 404) return null;
				throw err;
			}
		},

		/**
		 * Campaigns the agent is currently refusing to act on because they
		 * have no goal or their objective drifted from the configured one.
		 */
		pending(): Promise<PendingGuidance[]> {
			return request<PendingGuidance[]>("/api/goals/pending");
		},

		/**
		 * Suggest a sensible default goal for a Meta objective. Used by
		 * the configure-goal form to prefill values.
		 */
		defaults(objective: string): Promise<DefaultGoal> {
			const qs = new URLSearchParams({ objective }).toString();
			return request<DefaultGoal>(`/api/goals/defaults?${qs}`);
		},

		/**
		 * Create or replace a goal for a campaign. The backend
		 * soft-deletes any existing goal first, so the active-row
		 * invariant stays clean and history is preserved by the table.
		 */
		upsert(input: CampaignGoalUpsert): Promise<CampaignGoal> {
			return request<CampaignGoal>("/api/goals", {
				method: "POST",
				body: JSON.stringify(input),
			});
		},

		/** Soft-delete a campaign's goal so it surfaces as pending again. */
		reset(campaignId: string): Promise<{ success: boolean; deletedAt: string | null }> {
			return request<{ success: boolean; deletedAt: string | null }>(
				`/api/goals/${encodeURIComponent(campaignId)}`,
				{ method: "DELETE" },
			);
		},
	},

	/**
	 * Agent control actions.
	 */
	control: {
		/**
		 * Pause the running agent.
		 */
		pause(): Promise<void> {
			return request<void>("/api/control/pause", { method: "POST" });
		},

		/**
		 * Resume a paused agent.
		 */
		resume(): Promise<void> {
			return request<void>("/api/control/resume", { method: "POST" });
		},

		/**
		 * Trigger a single OODA tick.
		 */
		runOnce(): Promise<void> {
			return request<void>("/api/control/run-once", { method: "POST" });
		},
	},
};
