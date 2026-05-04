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
export type DecisionStatus = "pending" | "executed" | "failed";

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
 * Campaign metrics snapshot.
 */
export interface CampaignMetrics {
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
	adSets: Array<{
		id: string;
		name: string;
		status: string;
		spend7d: number;
		roas7d: number;
		cpa7d: number;
	}>;
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
