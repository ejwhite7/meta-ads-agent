/**
 * React hook for polling agent status.
 *
 * Fetches the current agent status from the API every 10 seconds.
 * Returns the latest status, loading state, and any error message.
 */

import { useState, useEffect, useCallback } from "react";
import { api, type AgentStatus } from "../api/client";
import { POLL_INTERVAL_MS } from "../lib/constants";

/**
 * Return type for the useAgentStatus hook.
 */
interface UseAgentStatusResult {
  /** Latest agent status, or null if not yet loaded. */
  status: AgentStatus | null;
  /** Whether the initial fetch is in progress. */
  loading: boolean;
  /** Human-readable error message, or null if no error. */
  error: string | null;
}

/**
 * Poll the agent status endpoint at a regular interval.
 *
 * @returns The latest status, loading flag, and error message.
 */
export function useAgentStatus(): UseAgentStatusResult {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api.getStatus();
      setStatus(data);
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch agent status.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();

    const interval = setInterval(() => void fetchStatus(), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return { status, loading, error };
}
