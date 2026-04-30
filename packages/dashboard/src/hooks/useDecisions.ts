/**
 * React hook for fetching and filtering agent decisions.
 *
 * Retrieves the decision log from the API with optional
 * status filtering and text search. Re-fetches when filters change.
 */

import { useEffect, useState } from "react";
import { type AuditRecord, type DecisionFilter, api } from "../api/client";

/**
 * Return type for the useDecisions hook.
 */
interface UseDecisionsResult {
	/** List of audit records matching the current filters. */
	decisions: AuditRecord[];
	/** Whether the fetch is in progress. */
	loading: boolean;
	/** Human-readable error message, or null if no error. */
	error: string | null;
}

/**
 * Fetch agent decisions with optional filtering.
 *
 * @param filter - Optional filter parameters (status, search, limit, offset).
 * @returns The matched decisions, loading flag, and error message.
 */
export function useDecisions(filter?: DecisionFilter): UseDecisionsResult {
	const [decisions, setDecisions] = useState<AuditRecord[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: filter is destructured into stable primitives
	useEffect(() => {
		let cancelled = false;

		async function fetchDecisions(): Promise<void> {
			setLoading(true);
			try {
				const data = await api.getDecisions(filter);
				if (!cancelled) {
					setDecisions(data);
					setError(null);
				}
			} catch (err: unknown) {
				if (!cancelled) {
					const message = err instanceof Error ? err.message : "Failed to fetch decisions.";
					setError(message);
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		}

		void fetchDecisions();

		return () => {
			cancelled = true;
		};
	}, [filter?.status, filter?.search, filter?.limit, filter?.offset]);

	return { decisions, loading, error };
}
