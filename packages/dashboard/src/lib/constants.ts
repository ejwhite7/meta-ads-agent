/**
 * Application constants for the dashboard.
 *
 * Centralizes configuration values that may differ between
 * development and production environments.
 */

/**
 * Base URL for the dashboard API server.
 *
 * In development, Vite proxies /api requests to the Hono server.
 * In production, this resolves to the same origin.
 */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? "";

/**
 * Polling interval for the agent status endpoint (in milliseconds).
 * Default: 10 seconds.
 */
export const POLL_INTERVAL_MS: number = 10_000;

/**
 * Maximum number of decisions to display on the overview page.
 */
export const OVERVIEW_DECISION_LIMIT: number = 5;

/**
 * Default number of days for chart data ranges.
 */
export const DEFAULT_CHART_DAYS: number = 30;

/**
 * Default ROAS target used for visual indicators.
 */
export const DEFAULT_ROAS_TARGET: number = 4.0;
