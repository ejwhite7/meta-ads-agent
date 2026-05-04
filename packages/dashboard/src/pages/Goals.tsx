/**
 * Goals page — per-campaign goal management.
 *
 * Three sections:
 *   1. Pending guidance — campaigns the agent is refusing to act on
 *      because they have no goal (or their objective drifted from the
 *      configured one). Each row has a "Configure" button that opens
 *      the goal-configuration form prefilled with the default for the
 *      campaign's objective.
 *   2. Active goals — every (account, campaign) pair with a live goal.
 *      Each row has Edit / Reset.
 *   3. Goal form (modal-style panel) — used both by Configure and Edit.
 *
 * Parity with the `meta-ads-agent guidance` CLI (packages/cli/src/
 * commands/guidance.ts). Both paths persist via `CampaignGoalRepository`.
 */

import type React from "react";
import { useCallback, useEffect, useState } from "react";
import {
	type CampaignGoal,
	type CampaignGoalUpsert,
	type DefaultGoal,
	type KpiDirection,
	type PendingGuidance,
	type PrimaryKpi,
	api,
} from "../api/client";

/**
 * KPI choices for the configure form. Order matches the type union in
 * core/goals/types.ts and the inquirer choices in guidance.ts so the
 * three surfaces stay aligned.
 */
const KPI_CHOICES: ReadonlyArray<{ value: PrimaryKpi; label: string }> = [
	{ value: "roas", label: "ROAS — return on ad spend" },
	{ value: "cpa", label: "CPA — cost per acquisition" },
	{ value: "cpl", label: "CPL — cost per lead" },
	{ value: "cpc", label: "CPC — cost per click" },
	{ value: "ctr", label: "CTR — click-through rate" },
	{ value: "cpm", label: "CPM — cost per 1000 impressions" },
	{ value: "cpi", label: "CPI — cost per app install" },
	{ value: "cost_per_thruplay", label: "Cost per ThruPlay (video)" },
	{ value: "thruplay_rate", label: "ThruPlay rate (video)" },
	{ value: "frequency", label: "Frequency (awareness)" },
	{ value: "reach", label: "Reach (awareness)" },
];

/**
 * Form state for the configure / edit panel.
 */
interface FormState {
	campaignId: string;
	campaignName: string;
	objective: string;
	primaryKpi: PrimaryKpi;
	primaryKpiTarget: number;
	primaryKpiDirection: KpiDirection;
	notes: string;
}

/**
 * Tab state used to swap between pending and active views.
 */
type TabKey = "pending" | "active";

/**
 * Goals management page.
 */
export function Goals(): React.ReactElement {
	const [tab, setTab] = useState<TabKey>("pending");

	const [pending, setPending] = useState<PendingGuidance[] | null>(null);
	const [pendingError, setPendingError] = useState<string | null>(null);

	const [active, setActive] = useState<CampaignGoal[] | null>(null);
	const [activeError, setActiveError] = useState<string | null>(null);

	const [loading, setLoading] = useState(true);
	const [form, setForm] = useState<FormState | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const [flash, setFlash] = useState<string | null>(null);

	/* Refresh both lists. Called on mount and after every mutation. */
	const refresh = useCallback(async () => {
		setLoading(true);
		setPendingError(null);
		setActiveError(null);
		const [pendingResult, activeResult] = await Promise.allSettled([
			api.goals.pending(),
			api.goals.list(),
		]);
		if (pendingResult.status === "fulfilled") {
			setPending(pendingResult.value);
		} else {
			setPending([]);
			setPendingError(
				pendingResult.reason instanceof Error
					? pendingResult.reason.message
					: String(pendingResult.reason),
			);
		}
		if (activeResult.status === "fulfilled") {
			setActive(activeResult.value);
		} else {
			setActive([]);
			setActiveError(
				activeResult.reason instanceof Error
					? activeResult.reason.message
					: String(activeResult.reason),
			);
		}
		setLoading(false);
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	/**
	 * Open the form for a pending campaign, prefilled with the default
	 * KPI suggestion for its objective.
	 */
	async function openConfigureForm(p: PendingGuidance): Promise<void> {
		let def: DefaultGoal;
		try {
			def = await api.goals.defaults(p.currentObjective);
		} catch {
			/* Fallback: a generic CTR target. Mirrors the unknown-objective
			 * branch of inferDefaultKpi. */
			def = {
				primaryKpi: "ctr",
				primaryKpiTarget: 0.01,
				primaryKpiDirection: "maximize",
				promptLabel: "Target click-through rate",
				currency: false,
			};
		}
		setForm({
			campaignId: p.campaignId,
			campaignName: p.campaignName,
			objective: p.currentObjective,
			primaryKpi: def.primaryKpi,
			primaryKpiTarget: def.primaryKpiTarget,
			primaryKpiDirection: def.primaryKpiDirection,
			notes: "",
		});
		setSubmitError(null);
	}

	/**
	 * Open the form for an existing active goal.
	 */
	function openEditForm(g: CampaignGoal): void {
		setForm({
			campaignId: g.campaignId,
			campaignName: g.campaignId /* live name not in the goal row */,
			objective: g.lastSeenObjective,
			primaryKpi: g.primaryKpi,
			primaryKpiTarget: g.primaryKpiTarget,
			primaryKpiDirection: g.primaryKpiDirection,
			notes: g.notes ?? "",
		});
		setSubmitError(null);
	}

	/**
	 * Submit the form. The backend handles soft-delete-then-insert when
	 * a goal already exists, so this same handler covers Configure and Edit.
	 */
	async function submitForm(): Promise<void> {
		if (!form) return;
		if (!Number.isFinite(form.primaryKpiTarget) || form.primaryKpiTarget < 0) {
			setSubmitError("Target must be a non-negative number.");
			return;
		}
		setSubmitting(true);
		setSubmitError(null);
		try {
			const payload: CampaignGoalUpsert = {
				campaignId: form.campaignId,
				primaryKpi: form.primaryKpi,
				primaryKpiTarget: form.primaryKpiTarget,
				primaryKpiDirection: form.primaryKpiDirection,
				lastSeenObjective: form.objective,
				...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
			};
			await api.goals.upsert(payload);
			setFlash(`Saved goal for "${form.campaignName}".`);
			setForm(null);
			await refresh();
		} catch (err) {
			setSubmitError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	}

	async function resetGoal(g: CampaignGoal): Promise<void> {
		if (
			!confirm(
				`Reset goal for campaign ${g.campaignId}? The agent will stop acting on it until reconfigured.`,
			)
		)
			return;
		try {
			await api.goals.reset(g.campaignId);
			setFlash(`Reset goal for ${g.campaignId}. It will surface as pending until reconfigured.`);
			await refresh();
		} catch (err) {
			setFlash(`Reset failed: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	const pendingCount = pending?.length ?? 0;
	const activeCount = active?.length ?? 0;

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold text-gray-900">Goals</h1>
				<button
					type="button"
					onClick={() => void refresh()}
					className="text-sm text-blue-600 hover:text-blue-700 font-medium"
				>
					Refresh
				</button>
			</div>

			{flash && (
				<div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 flex items-center justify-between">
					<span>{flash}</span>
					<button
						type="button"
						className="text-green-700 hover:text-green-900"
						onClick={() => setFlash(null)}
					>
						×
					</button>
				</div>
			)}

			{/* Tabs */}
			<div className="border-b border-gray-200">
				<nav className="-mb-px flex gap-6">
					<TabButton
						active={tab === "pending"}
						onClick={() => setTab("pending")}
						label={`Pending guidance${pending ? ` (${pendingCount})` : ""}`}
					/>
					<TabButton
						active={tab === "active"}
						onClick={() => setTab("active")}
						label={`Active goals${active ? ` (${activeCount})` : ""}`}
					/>
				</nav>
			</div>

			{loading ? (
				<div className="flex items-center justify-center h-32">
					<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
				</div>
			) : tab === "pending" ? (
				<PendingTable
					pending={pending ?? []}
					error={pendingError}
					onConfigure={(p) => void openConfigureForm(p)}
				/>
			) : (
				<ActiveGoalsTable
					goals={active ?? []}
					error={activeError}
					onEdit={openEditForm}
					onReset={(g) => void resetGoal(g)}
				/>
			)}

			{form && (
				<GoalFormModal
					form={form}
					onChange={setForm}
					onSubmit={() => void submitForm()}
					onCancel={() => setForm(null)}
					submitting={submitting}
					error={submitError}
				/>
			)}
		</div>
	);
}

/* ---------- Sub-components ---------- */

function TabButton({
	active,
	onClick,
	label,
}: {
	active: boolean;
	onClick: () => void;
	label: string;
}): React.ReactElement {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
				active
					? "border-blue-600 text-blue-700"
					: "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
			}`}
		>
			{label}
		</button>
	);
}

function PendingTable({
	pending,
	error,
	onConfigure,
}: {
	pending: PendingGuidance[];
	error: string | null;
	onConfigure: (p: PendingGuidance) => void;
}): React.ReactElement {
	if (error) {
		return (
			<div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
				<p className="font-medium mb-1">Couldn't fetch pending campaigns from Meta.</p>
				<p>{error}</p>
				<p className="mt-2 text-xs text-red-700">
					The dashboard talks to graph.facebook.com via your configured access token. If the token
					is missing or expired, run <code className="font-mono">meta-ads-agent init</code> to
					reauthorize.
				</p>
			</div>
		);
	}
	if (pending.length === 0) {
		return (
			<div className="text-center py-12 text-gray-500">
				<p className="text-lg">No campaigns are pending guidance.</p>
				<p className="text-sm mt-1">
					Every active campaign has a goal. The agent will manage all of them on its next tick.
				</p>
			</div>
		);
	}
	return (
		<div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
			<table className="min-w-full divide-y divide-gray-200">
				<thead className="bg-gray-50">
					<tr>
						<Th>Campaign</Th>
						<Th>Status</Th>
						<Th>Objective</Th>
						<Th>Reason</Th>
						<Th align="right">Daily budget</Th>
						<Th align="right">Action</Th>
					</tr>
				</thead>
				<tbody className="bg-white divide-y divide-gray-200">
					{pending.map((p) => (
						<tr key={p.campaignId} className="hover:bg-gray-50">
							<td className="px-4 py-3 text-sm font-medium text-gray-900">
								{p.campaignName}
								<div className="text-xs text-gray-400 font-mono">{p.campaignId}</div>
							</td>
							<td className="px-4 py-3">
								<StatusBadge status={p.status} />
							</td>
							<td className="px-4 py-3 text-sm text-gray-700">{p.currentObjective}</td>
							<td className="px-4 py-3 text-sm text-gray-700">
								{p.reason === "no_goal_configured" && "No goal configured"}
								{p.reason === "objective_changed" && (
									<>
										Objective changed
										{p.previousObjective ? (
											<span className="text-xs text-gray-500"> (was {p.previousObjective})</span>
										) : null}
									</>
								)}
								{p.reason === "goal_explicitly_reset" && "Goal was reset"}
							</td>
							<td className="px-4 py-3 text-sm text-gray-700 text-right">
								{p.dailyBudget !== null ? `$${p.dailyBudget.toFixed(2)}` : "—"}
							</td>
							<td className="px-4 py-3 text-right">
								<button
									type="button"
									onClick={() => onConfigure(p)}
									className="px-3 py-1 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
								>
									Configure
								</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function ActiveGoalsTable({
	goals,
	error,
	onEdit,
	onReset,
}: {
	goals: CampaignGoal[];
	error: string | null;
	onEdit: (g: CampaignGoal) => void;
	onReset: (g: CampaignGoal) => void;
}): React.ReactElement {
	if (error) {
		return (
			<div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
				{error}
			</div>
		);
	}
	if (goals.length === 0) {
		return (
			<div className="text-center py-12 text-gray-500">
				<p className="text-lg">No goals configured yet.</p>
				<p className="text-sm mt-1">Configure pending campaigns above to get started.</p>
			</div>
		);
	}
	return (
		<div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
			<table className="min-w-full divide-y divide-gray-200">
				<thead className="bg-gray-50">
					<tr>
						<Th>Campaign</Th>
						<Th>Objective</Th>
						<Th>KPI</Th>
						<Th align="right">Target</Th>
						<Th>Configured</Th>
						<Th align="right">Actions</Th>
					</tr>
				</thead>
				<tbody className="bg-white divide-y divide-gray-200">
					{goals.map((g) => (
						<tr key={g.dbId} className="hover:bg-gray-50">
							<td className="px-4 py-3 text-sm font-mono text-gray-900">{g.campaignId}</td>
							<td className="px-4 py-3 text-sm text-gray-700">{g.lastSeenObjective}</td>
							<td className="px-4 py-3 text-sm text-gray-700">
								{g.primaryKpi}{" "}
								<span className="text-xs text-gray-400">
									{g.primaryKpiDirection === "maximize" ? "↑" : "↓"}
								</span>
							</td>
							<td className="px-4 py-3 text-sm text-gray-700 text-right">{g.primaryKpiTarget}</td>
							<td className="px-4 py-3 text-xs text-gray-500">
								{g.configuredAt.replace("T", " ").slice(0, 19)}
								<div className="text-gray-400">by {g.configuredBy}</div>
							</td>
							<td className="px-4 py-3 text-right space-x-2">
								<button
									type="button"
									onClick={() => onEdit(g)}
									className="px-3 py-1 text-sm font-medium text-blue-700 bg-blue-50 rounded hover:bg-blue-100"
								>
									Edit
								</button>
								<button
									type="button"
									onClick={() => onReset(g)}
									className="px-3 py-1 text-sm font-medium text-red-700 bg-red-50 rounded hover:bg-red-100"
								>
									Reset
								</button>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function GoalFormModal({
	form,
	onChange,
	onSubmit,
	onCancel,
	submitting,
	error,
}: {
	form: FormState;
	onChange: (f: FormState) => void;
	onSubmit: () => void;
	onCancel: () => void;
	submitting: boolean;
	error: string | null;
}): React.ReactElement {
	return (
		<div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
			<div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6 space-y-4">
				<div>
					<h2 className="text-lg font-semibold text-gray-900">Configure goal</h2>
					<p className="text-sm text-gray-500 mt-1">
						{form.campaignName}{" "}
						<span className="text-xs text-gray-400 font-mono">({form.campaignId})</span>
					</p>
					<p className="text-xs text-gray-500 mt-1">Objective: {form.objective}</p>
				</div>

				<div className="grid grid-cols-2 gap-4">
					<Field label="Primary KPI">
						<select
							value={form.primaryKpi}
							onChange={(e) => onChange({ ...form, primaryKpi: e.target.value as PrimaryKpi })}
							className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
						>
							{KPI_CHOICES.map((c) => (
								<option key={c.value} value={c.value}>
									{c.label}
								</option>
							))}
						</select>
					</Field>
					<Field label="Direction">
						<select
							value={form.primaryKpiDirection}
							onChange={(e) =>
								onChange({ ...form, primaryKpiDirection: e.target.value as KpiDirection })
							}
							className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
						>
							<option value="maximize">Maximize (higher is better)</option>
							<option value="minimize">Minimize (lower is better)</option>
						</select>
					</Field>
					<Field label="Target value">
						<input
							type="number"
							step="any"
							min="0"
							value={form.primaryKpiTarget}
							onChange={(e) =>
								onChange({
									...form,
									primaryKpiTarget: Number.parseFloat(e.target.value),
								})
							}
							className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
						/>
					</Field>
				</div>

				<Field label="Notes (optional)">
					<textarea
						rows={2}
						value={form.notes}
						onChange={(e) => onChange({ ...form, notes: e.target.value })}
						className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
						placeholder="Why this target? Any context for future you."
					/>
				</Field>

				{error && (
					<div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-800">
						{error}
					</div>
				)}

				<div className="flex items-center justify-end gap-2 pt-2">
					<button
						type="button"
						onClick={onCancel}
						disabled={submitting}
						className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onSubmit}
						disabled={submitting}
						className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
					>
						{submitting ? "Saving…" : "Save goal"}
					</button>
				</div>
			</div>
		</div>
	);
}

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}): React.ReactElement {
	return (
		<div>
			<div className="block text-xs font-medium text-gray-600 mb-1">{label}</div>
			{children}
		</div>
	);
}

function Th({
	children,
	align,
}: {
	children: React.ReactNode;
	align?: "right";
}): React.ReactElement {
	return (
		<th
			className={`px-4 py-3 text-${align ?? "left"} text-xs font-medium text-gray-500 uppercase tracking-wider`}
		>
			{children}
		</th>
	);
}

function StatusBadge({ status }: { status: string }): React.ReactElement {
	const isActive = status === "ACTIVE";
	return (
		<span
			className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
				isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
			}`}
		>
			{status}
		</span>
	);
}
