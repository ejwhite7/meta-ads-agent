/**
 * React hook for fetching campaign metrics.
 *
 * Retrieves the list of managed campaigns with their performance
 * metrics from the API. Fetches on mount.
 */

import { useEffect, useState } from "react";
import { type CampaignMetrics, api } from "../api/client";

/**
 * Return type for the useCampaigns hook.
 */
interface UseCampaignsResult {
	/** List of campaigns with metrics. */
	campaigns: CampaignMetrics[];
	/** Whether the fetch is in progress. */
	loading: boolean;
	/** Human-readable error message, or null if no error. */
	error: string | null;
}

/**
 * Fetch campaign metrics from the API.
 *
 * @returns The campaigns list, loading flag, and error message.
 */
export function useCampaigns(): UseCampaignsResult {
	const [campaigns, setCampaigns] = useState<CampaignMetrics[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		async function fetchCampaigns(): Promise<void> {
			try {
				const data = await api.getCampaigns();
				if (!cancelled) {
					setCampaigns(data);
					setError(null);
				}
			} catch (err: unknown) {
				if (!cancelled) {
					const message = err instanceof Error ? err.message : "Failed to fetch campaigns.";
					setError(message);
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		}

		void fetchCampaigns();

		return () => {
			cancelled = true;
		};
	}, []);

	return { campaigns, loading, error };
}
