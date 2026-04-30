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
 * A single audit record from the agent decision log.
 */
export interface AuditRecord {
	id: string;
	timestamp: string;
	sessionId: string;
	toolName: string;
	toolParams: Record<string, unknown>;
	llmReasoning: string;
	inputMetrics: Record<string, unknown>;
	expectedOutcome: Record<string, unknown> | null;
	actualOutcome: Record<string, unknown> | null;
	performanceDelta: Record<string, unknown> | null;
	status: "pending" | "executed" | "failed" | "skipped";
}

/**
 * Filter parameters for the decisions endpoint.
 */
export interface DecisionFilter {
	status?: "pending" | "executed" | "failed" | "skipped";
	search?: string;
	limit?: number;
	offset?: number;
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
	 * Fetch the agent decision log with optional filters.
	 */
	getDecisions(filter?: DecisionFilter): Promise<AuditRecord[]> {
		const params = new URLSearchParams();
		if (filter?.status) params.set("status", filter.status);
		if (filter?.search) params.set("search", filter.search);
		if (filter?.limit) params.set("limit", String(filter.limit));
		if (filter?.offset) params.set("offset", String(filter.offset));

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
