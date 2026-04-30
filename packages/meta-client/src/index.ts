/**
 * @meta-ads-agent/meta-client
 *
 * Hybrid Meta integration layer combining two access patterns:
 *
 * 1. **CLI Wrapper** (`./cli/`): Spawns the official `meta-ads` Python CLI
 *    as a subprocess. Covers 47 commands across 11 resource groups:
 *    campaigns, ad sets, ads, creatives, datasets, catalogs, product items,
 *    product sets, insights, ad accounts, pages, and authentication.
 *    Uses --output json --no-input for machine-readable, non-interactive
 *    execution. Handles exit codes 0-5 with appropriate retry/halt logic.
 *
 * 2. **Direct API Client** (`./api/`): axios-based client calling
 *    graph.facebook.com/v21.0 directly for capabilities the CLI lacks:
 *    - Custom and Lookalike Audience management
 *    - Batch operations for bulk changes
 *    - A/B test creation and management
 *    - Automated ad rules engine
 *    - Advanced targeting (interests, behaviors, demographics)
 *
 * Also includes:
 * - Rate limit budget tracker (per-account token budget from BUC headers)
 * - Token storage (local: ~/.meta-ads-agent/config.json, cloud: env vars)
 *
 * Architecture reference: see CLAUDE.md sections 4 and 13 in the repo root.
 */

export {};
