/**
 * Decisions page — full agent decision log.
 *
 * Columns: timestamp, tool, action params, reasoning, status, and
 * (post-PR-#38) the **graded** outcome — when a future tick has
 * recorded the actual post-decision metrics, the table shows a
 * compact ROAS / Spend / CPA delta plus an expandable detail panel
 * with the full snapshot. Without grading, the column shows an em
 * dash and the status badge alone.
 *
 * The audit log is append-only: rows that haven't been graded yet
 * stay un-graded forever if the campaign goes silent (paused,
 * deleted, no delivery). That's design intent — the absence of a
 * grade is informative.
 */

import type React from "react";
import { useMemo, useState } from "react";
import {
	type AuditRecord,
	decisionDelta,
	decisionParams,
	decisionStatus,
	favorableDirection,
	isGraded,
} from "../api/client";
import { useDecisions } from "../hooks/useDecisions";
import { rangeToIso, useDateRange } from "../lib/date-range";

/**
 * Status filter options for the decision log. Mirrors the union in
 * `decisionStatus()`. "graded" is a derived state on top of "executed"
 * — a graded row is also executed — so we don't add it as a filter
 * option to keep the dropdown semantics simple.
 */
type StatusFilter = "all" | "executed" | "failed" | "pending" | "resolved";

export function Decisions(): React.ReactElement {
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [searchQuery, setSearchQuery] = useState("");

	const { range } = useDateRange();
	const iso = rangeToIso(range);
	const { decisions, loading, error } = useDecisions({
		limit: 200,
		startDate: iso.startDate,
		endDate: iso.endDate,
	});

	const filtered = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		return decisions.filter((d) => {
			if (statusFilter !== "all" && decisionStatus(d) !== statusFilter) return false;
			if (q.length > 0) {
				const hay = `${d.toolName} ${d.reasoning} ${d.expectedOutcome} ${d.params}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	}, [decisions, statusFilter, searchQuery]);

	const gradedCount = useMemo(() => filtered.filter(isGraded).length, [filtered]);

	return (
		<div className="space-y-6">
			<div className="flex items-baseline justify-between">
				<h1 className="text-2xl font-bold text-gray-900">Decision Log</h1>
				{filtered.length > 0 && (
					<span className="text-sm text-gray-500">
						{gradedCount} of {filtered.length} graded
					</span>
				)}
			</div>

			<div className="flex flex-col sm:flex-row gap-4">
				<input
					type="text"
					placeholder="Search decisions..."
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
				/>
				<select
					value={statusFilter}
					onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
					className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
				>
					<option value="all">All Statuses</option>
					<option value="executed">Successful</option>
					<option value="failed">Failed</option>
					<option value="pending">Pending Approval</option>
					<option value="resolved">Resolved</option>
				</select>
			</div>

			{error && (
				<div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
					<p className="text-sm">{error}</p>
				</div>
			)}

			{loading && (
				<div className="flex items-center justify-center h-32">
					<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
				</div>
			)}

			{!loading && filtered.length === 0 && (
				<div className="text-center py-12 text-gray-500">
					<p className="text-lg">No decisions found.</p>
					<p className="text-sm mt-1">
						{searchQuery || statusFilter !== "all"
							? "Try adjusting your filters."
							: "The agent has not made any decisions yet."}
					</p>
				</div>
			)}

			{!loading && filtered.length > 0 && (
				<div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
					<table className="min-w-full divide-y divide-gray-200">
						<thead className="bg-gray-50">
							<tr>
								<Th>Time</Th>
								<Th>Tool</Th>
								<Th>Action</Th>
								<Th>Reasoning</Th>
								<Th>Status</Th>
								<Th align="right">Outcome Δ</Th>
							</tr>
						</thead>
						<tbody className="bg-white divide-y divide-gray-200">
							{filtered.map((decision: AuditRecord) => (
								<DecisionTableRow key={decision.id} decision={decision} />
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

function DecisionTableRow({
	decision,
}: {
	decision: AuditRecord;
}): React.ReactElement {
	const [expanded, setExpanded] = useState(false);

	const statusColors: Record<string, string> = {
		executed: "bg-green-100 text-green-800",
		failed: "bg-red-100 text-red-800",
		pending: "bg-yellow-100 text-yellow-800",
		resolved: "bg-gray-100 text-gray-600 line-through",
	};

	const reasoning = decision.reasoning ?? "";
	const reasoningTruncated = reasoning.length > 120 && !expanded;
	const displayReasoning = reasoningTruncated ? `${reasoning.slice(0, 120)}...` : reasoning;
	const params = decisionParams(decision);
	const paramsLabel = JSON.stringify(params).slice(0, 80);
	const status = decisionStatus(decision);
	const graded = isGraded(decision);
	const canExpand = reasoning.length > 120 || graded;

	return (
		<>
			<tr className="hover:bg-gray-50">
				<td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
					{new Date(decision.timestamp).toLocaleString()}
				</td>
				<td className="px-4 py-3">
					<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
						{decision.toolName}
					</span>
				</td>
				<td className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate" title={paramsLabel}>
					{paramsLabel}
				</td>
				<td className="px-4 py-3 text-sm text-gray-600 max-w-xs">
					<span>{displayReasoning}</span>
					{canExpand && (
						<button
							type="button"
							onClick={() => setExpanded(!expanded)}
							className="ml-1 text-blue-600 hover:text-blue-800 text-xs font-medium"
						>
							{expanded ? "Hide" : "More"}
						</button>
					)}
				</td>
				<td className="px-4 py-3">
					<div className="flex flex-col gap-1">
						<span
							className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium w-fit ${
								statusColors[status] ?? "bg-gray-100 text-gray-800"
							}`}
						>
							{status}
						</span>
						{graded && (
							<span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 w-fit">
								graded
							</span>
						)}
					</div>
				</td>
				<td className="px-4 py-3 text-right">
					<DeltaCell decision={decision} status={status} />
				</td>
			</tr>
			{expanded && graded && (
				<tr className="bg-gray-50">
					<td colSpan={6} className="px-4 py-3">
						<DetailPanel decision={decision} />
					</td>
				</tr>
			)}
		</>
	);
}

/**
 * Compact three-line delta display for the Outcome Δ column.
 *
 * Shows ROAS / Spend / CPA — the three the operator scans first.
 * Coloring is goal-aware (PR #39): each metric's favorable direction
 * is determined by the row's `goalContext` (the active per-campaign
 * goal at render time), falling back to intuitive defaults (ROAS up
 * = good; CPA / spend down = good). The metric matching the
 * campaign's primary KPI gets a small ★ marker so the operator can
 * tell which line is the goal target.
 */
function DeltaCell({
	decision,
	status,
}: {
	decision: AuditRecord;
	status: string;
}): React.ReactElement {
	if (status === "failed" || status === "pending" || status === "resolved") {
		return <span className="text-xs text-gray-300">—</span>;
	}
	const delta = decisionDelta(decision);
	if (!delta) {
		return (
			<span
				className="text-xs text-gray-400"
				title="Decision hasn't been graded yet — backfill engine populates this on a future tick."
			>
				ungraded
			</span>
		);
	}
	const goal = decision.goalContext ?? null;
	const lines: Array<{
		label: string;
		metric: string;
		value: number;
		format: "signed" | "dollar";
	}> = [];
	if (delta.roas !== undefined && delta.roas !== 0) {
		lines.push({ label: "ROAS", metric: "roas", value: delta.roas, format: "signed" });
	}
	if (delta.spend !== undefined && delta.spend !== 0) {
		lines.push({ label: "Spend", metric: "spend", value: delta.spend, format: "dollar" });
	}
	if (delta.cpa !== undefined && delta.cpa !== 0) {
		lines.push({ label: "CPA", metric: "cpa", value: delta.cpa, format: "dollar" });
	}
	if (lines.length === 0) {
		return (
			<div className="flex flex-col items-end gap-0.5 text-xs font-mono">
				<span className="text-gray-300">no change</span>
			</div>
		);
	}
	return (
		<div className="flex flex-col items-end gap-0.5 text-xs font-mono">
			{lines.map((line) => (
				<DeltaLine
					key={line.metric}
					label={line.label}
					metric={line.metric}
					value={line.value}
					format={line.format}
					goalContext={goal}
					isPrimary={goal?.primaryKpi === line.metric}
				/>
			))}
		</div>
	);
}

function DeltaLine({
	label,
	metric,
	value,
	format,
	goalContext,
	isPrimary,
}: {
	label: string;
	metric: string;
	value: number;
	format: "signed" | "dollar";
	goalContext: AuditRecord["goalContext"];
	isPrimary: boolean;
}): React.ReactElement {
	const sign = value > 0 ? "+" : "";
	const formatted =
		format === "dollar" ? `${sign}$${value.toFixed(2)}` : `${sign}${value.toFixed(2)}`;

	/* Goal-aware coloring: a +0.3 ROAS Δ reads green under a
	 * roas-maximize goal but neutral under a goal targeting a
	 * different KPI. `favorableDirection` returns 'higher' | 'lower'
	 * | 'neutral' — we color positive/negative against the favorable
	 * direction, and gray when neutral or zero. */
	const direction = favorableDirection(metric, goalContext);
	let color: string;
	if (value === 0 || direction === "neutral") {
		color = "text-gray-500";
	} else if (direction === "higher") {
		color = value > 0 ? "text-green-700" : "text-red-700";
	} else {
		color = value < 0 ? "text-green-700" : "text-red-700";
	}

	const goalSet = goalContext && goalContext.primaryKpi === metric;
	const tooltip = goalSet
		? `Primary KPI for this campaign (${goalContext.primaryKpiDirection}). Target ${goalContext.primaryKpiTarget}.`
		: direction === "neutral"
			? "No favorable direction known for this metric."
			: `${direction === "higher" ? "Higher" : "Lower"} is favorable (default; no per-campaign goal on this KPI).`;

	return (
		<span className={color} title={tooltip}>
			<span className="text-[10px] text-gray-400 mr-1">
				{isPrimary && <span className="text-amber-500 mr-0.5">★</span>}
				{label}
			</span>
			{formatted}
		</span>
	);
}

/**
 * Expanded detail panel — full delta + actual outcome JSON. Surfaced
 * only for graded rows so the operator can see "what was the agent
 * looking at vs what actually happened next tick."
 */
function DetailPanel({ decision }: { decision: AuditRecord }): React.ReactElement {
	const delta = decisionDelta(decision);
	const actual = decision.actualOutcome ?? null;
	const baselineAt =
		typeof delta?.baselineRecordedAt === "string" ? delta.baselineRecordedAt : null;

	return (
		<div className="text-xs text-gray-700 space-y-2">
			<div className="font-medium text-gray-900">Graded outcome</div>
			{baselineAt && (
				<div className="text-gray-500">
					Baseline snapshot: {new Date(baselineAt).toLocaleString()}
				</div>
			)}
			<div className="grid grid-cols-2 gap-x-6 gap-y-1 max-w-2xl">
				<DetailRow label="Expected outcome" value={decision.expectedOutcome ?? "—"} />
				<DetailRow label="Risk level" value={decision.riskLevel ?? "—"} />
				<DetailRow
					label="Score"
					value={typeof decision.score === "number" ? decision.score.toFixed(2) : "—"}
				/>
				<DetailRow label="Session" value={decision.sessionId.slice(0, 8)} />
			</div>
			<details className="mt-2">
				<summary className="cursor-pointer text-gray-500 hover:text-gray-700">
					Raw outcome / delta JSON
				</summary>
				<pre className="mt-1 p-2 bg-white border border-gray-200 rounded text-[11px] overflow-x-auto">
					{JSON.stringify({ actualOutcome: actual, performanceDelta: delta }, null, 2)}
				</pre>
			</details>
		</div>
	);
}

function DetailRow({
	label,
	value,
}: {
	label: string;
	value: string;
}): React.ReactElement {
	return (
		<div>
			<span className="text-gray-500 mr-2">{label}:</span>
			<span className="font-mono">{value}</span>
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
