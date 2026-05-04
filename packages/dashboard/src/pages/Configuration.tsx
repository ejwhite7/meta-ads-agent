/**
 * Configuration page — account-wide guardrails (editable) plus a
 * read-only summary of runtime settings the daemon is currently using.
 *
 * Pre-this-PR the page rendered fixed defaults and a "Save" button that
 * only wrote to localStorage — clicking it accomplished nothing. The
 * fields conflated four sources of truth: `agent_config` (DB),
 * `config.json` (file), `daemon.json` (process state), and `campaign_goals`
 * (per-campaign). This page now only handles the first one; the others
 * link out to the right place.
 *
 * Editable: `roasTarget`, `cpaCap`, `dailyBudgetLimit`, `riskLevel` —
 * persisted to `agent_config` via `PUT /api/configuration`. The running
 * daemon won't re-read these until restart (the AgentGoal is captured
 * once at session construction and used to bind the budget tools); we
 * surface that in the success message.
 *
 * Read-only:
 *   - LLM provider — change via `meta-ads-agent init` then restart daemon.
 *   - Tick interval — restart daemon with `--interval N` flag.
 *   - Per-campaign overrides (min budget, max scale, approval threshold)
 *     — these live on `campaign_goals` per DESIGN.md §2/§3, accessed
 *     via the Goals page.
 */

import type React from "react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
	type ConfigurationResponse,
	type ConfigurationUpdateInput,
	type RiskLevel,
	api,
} from "../api/client";

/**
 * Local form state. Mirrors the editable subset of the configuration.
 */
interface FormState {
	roasTarget: number;
	cpaCap: number;
	dailyBudgetLimit: number;
	riskLevel: RiskLevel;
}

/** Sensible first-time defaults when no agent_config row exists yet. */
const DEFAULT_FORM: FormState = {
	roasTarget: 4.0,
	cpaCap: 25.0,
	dailyBudgetLimit: 500,
	riskLevel: "moderate",
};

export function Configuration(): React.ReactElement {
	const [data, setData] = useState<ConfigurationResponse | null>(null);
	const [form, setForm] = useState<FormState>(DEFAULT_FORM);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [savedFlash, setSavedFlash] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		api.configuration
			.get()
			.then((res) => {
				if (cancelled) return;
				setData(res);
				if (res.guardrails) {
					setForm({
						roasTarget: res.guardrails.roasTarget,
						cpaCap: res.guardrails.cpaCap,
						dailyBudgetLimit: res.guardrails.dailyBudgetLimit,
						riskLevel: res.guardrails.riskLevel,
					});
				}
				setLoadError(null);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setLoadError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
		setForm((prev) => ({ ...prev, [key]: value }));
		setSavedFlash(null);
	}

	async function handleSave(): Promise<void> {
		if (
			!Number.isFinite(form.roasTarget) ||
			!Number.isFinite(form.cpaCap) ||
			!Number.isFinite(form.dailyBudgetLimit)
		) {
			setSaveError("All numeric fields must be valid numbers.");
			return;
		}
		if (form.roasTarget < 0 || form.cpaCap < 0 || form.dailyBudgetLimit < 0) {
			setSaveError("All numeric fields must be non-negative.");
			return;
		}
		setSaving(true);
		setSaveError(null);
		try {
			const payload: ConfigurationUpdateInput = {
				roasTarget: form.roasTarget,
				cpaCap: form.cpaCap,
				dailyBudgetLimit: form.dailyBudgetLimit,
				riskLevel: form.riskLevel,
			};
			const result = await api.configuration.update(payload);
			setData((prev) => (prev ? { ...prev, guardrails: result.guardrails } : prev));
			setSavedFlash(
				result.requiresDaemonRestart
					? "Saved. Restart the daemon (Ctrl-C and rerun `meta-ads-agent run`) to apply to the running session."
					: "Saved.",
			);
		} catch (err) {
			setSaveError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}

	if (loading) {
		return (
			<div className="space-y-6 max-w-3xl">
				<h1 className="text-2xl font-bold text-gray-900">Configuration</h1>
				<div className="flex items-center justify-center h-32">
					<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
				</div>
			</div>
		);
	}

	if (loadError) {
		return (
			<div className="space-y-6 max-w-3xl">
				<h1 className="text-2xl font-bold text-gray-900">Configuration</h1>
				<div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
					Failed to load configuration: {loadError}
				</div>
			</div>
		);
	}

	const runtime = data?.runtime;

	return (
		<div className="space-y-6 max-w-3xl">
			<h1 className="text-2xl font-bold text-gray-900">Configuration</h1>

			{/* Account-wide guardrails (editable) */}
			<section className="bg-white rounded-lg border border-gray-200 p-6">
				<div className="mb-4">
					<h2 className="text-lg font-semibold text-gray-900">Account-wide guardrails</h2>
					<p className="text-sm text-gray-500 mt-1">
						Bound to the budget tools at daemon start. Per-campaign goals (the agent's actual
						optimization targets) live under{" "}
						<Link to="/goals" className="text-blue-600 hover:text-blue-700 underline">
							Goals
						</Link>
						.
					</p>
				</div>
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<Field label="ROAS Target" htmlFor="cfg-roas">
						<input
							id="cfg-roas"
							type="number"
							step="0.1"
							min="0"
							value={form.roasTarget}
							onChange={(e) => update("roasTarget", Number.parseFloat(e.target.value))}
							className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
						/>
					</Field>
					<Field label="CPA Cap ($)" htmlFor="cfg-cpa">
						<input
							id="cfg-cpa"
							type="number"
							step="0.01"
							min="0"
							value={form.cpaCap}
							onChange={(e) => update("cpaCap", Number.parseFloat(e.target.value))}
							className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
						/>
					</Field>
					<Field label="Daily Budget Limit ($)" htmlFor="cfg-budget">
						<input
							id="cfg-budget"
							type="number"
							step="1"
							min="0"
							value={form.dailyBudgetLimit}
							onChange={(e) => update("dailyBudgetLimit", Number.parseFloat(e.target.value))}
							className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
						/>
					</Field>
					<Field label="Risk Level" htmlFor="cfg-risk">
						<select
							id="cfg-risk"
							value={form.riskLevel}
							onChange={(e) => update("riskLevel", e.target.value as RiskLevel)}
							className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
						>
							<option value="conservative">Conservative</option>
							<option value="moderate">Moderate</option>
							<option value="aggressive">Aggressive</option>
						</select>
					</Field>
				</div>

				<div className="flex items-center gap-3 mt-6">
					<button
						type="button"
						onClick={() => void handleSave()}
						disabled={saving}
						className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{saving ? "Saving…" : "Save guardrails"}
					</button>
					{savedFlash && <span className="text-sm text-green-700">{savedFlash}</span>}
					{saveError && <span className="text-sm text-red-700">Error: {saveError}</span>}
				</div>

				{data?.guardrails?.configuredAt && (
					<p className="text-xs text-gray-400 mt-3">
						Last saved: {new Date(data.guardrails.configuredAt).toLocaleString()}
					</p>
				)}
			</section>

			{/* Read-only runtime summary */}
			<section className="bg-white rounded-lg border border-gray-200 p-6">
				<div className="mb-4">
					<h2 className="text-lg font-semibold text-gray-900">Runtime (read-only)</h2>
					<p className="text-sm text-gray-500 mt-1">
						These values come from the daemon process and config file. Changing them requires the
						action listed next to each.
					</p>
				</div>

				<dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
					<RuntimeRow
						label="LLM Provider"
						value={runtime?.llmProvider ?? "—"}
						hint="Change with meta-ads-agent init, then restart the daemon."
					/>
					<RuntimeRow
						label="Tick Interval"
						value={
							runtime?.tickIntervalMinutes
								? `${runtime.tickIntervalMinutes} minute${runtime.tickIntervalMinutes === 1 ? "" : "s"}`
								: "—"
						}
						hint="Restart daemon with --interval N to change."
					/>
					<RuntimeRow
						label="Ad Account"
						value={runtime?.adAccountId ?? "—"}
						hint="Set during meta-ads-agent init."
					/>
					<RuntimeRow
						label="Database"
						value={runtime?.dbType ?? "—"}
						hint="SQLite default at ~/.meta-ads-agent/agent.db."
					/>
					<RuntimeRow
						label="Dry Run"
						value={runtime?.dryRun ? "ENABLED — no live writes" : "Disabled"}
						hint="Toggle via --dry-run flag at daemon start."
					/>
				</dl>
			</section>

			{/* Per-campaign goals link */}
			<section className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900">
				<p>
					<strong>Looking for per-campaign goals?</strong> The agent's actual optimization targets —
					primary KPI per campaign, target value, direction, secondary KPIs, and per-campaign budget
					overrides — live on the{" "}
					<Link to="/goals" className="font-medium underline hover:text-blue-700">
						Goals page
					</Link>
					. The fields above are account-wide guardrails the budget tools bind against.
				</p>
			</section>
		</div>
	);
}

function Field({
	label,
	htmlFor,
	children,
}: {
	label: string;
	htmlFor: string;
	children: React.ReactNode;
}): React.ReactElement {
	return (
		<div>
			<label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 mb-1">
				{label}
			</label>
			{children}
		</div>
	);
}

function RuntimeRow({
	label,
	value,
	hint,
}: {
	label: string;
	value: string;
	hint: string;
}): React.ReactElement {
	return (
		<div>
			<dt className="text-xs uppercase tracking-wider text-gray-500">{label}</dt>
			<dd className="text-gray-900 font-medium mt-1">{value}</dd>
			<p className="text-xs text-gray-400 mt-0.5">{hint}</p>
		</div>
	);
}
