/**
 * Decisions page — full agent decision log.
 *
 * Displays a searchable, filterable table of all agent decisions
 * with columns for timestamp, tool, action, reasoning, outcome,
 * and performance delta.
 */

import type React from "react";
import { useMemo, useState } from "react";
import { type AuditRecord, decisionParams, decisionStatus } from "../api/client";
import { useDecisions } from "../hooks/useDecisions";
import { rangeToIso, useDateRange } from "../lib/date-range";

/**
 * Status filter options for the decision log.
 *
 * "skipped" was in the original scaffold but the backend never emits
 * such a status -- audit rows are either successful, failed, or pending
 * approval. Removed from the dropdown to avoid an empty filter state.
 */
type StatusFilter = "all" | "executed" | "failed" | "pending";

/**
 * Full decision log page with search and status filtering.
 */
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

	/* Filtering happens client-side because the /api/decisions endpoint
	 * doesn't yet honor status/search query params. We fetch a generous
	 * page (200) and prune. Server-side filter support is tracked in a
	 * follow-up. */
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

	return (
		<div className="space-y-6">
			<h1 className="text-2xl font-bold text-gray-900">Decision Log</h1>

			{/* Filters */}
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
				</select>
			</div>

			{/* Error state */}
			{error && (
				<div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
					<p className="text-sm">{error}</p>
				</div>
			)}

			{/* Loading state */}
			{loading && (
				<div className="flex items-center justify-center h-32">
					<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
				</div>
			)}

			{/* Decision list */}
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
								<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
									Time
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
									Tool
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
									Action
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
									Reasoning
								</th>
								<th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
									Outcome
								</th>
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

/**
 * Individual row in the decision table.
 *
 * Reasoning text is truncated with an expand toggle to avoid
 * overwhelming the table layout.
 */
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
	};

	/* The backend stores only `reasoning` (text) and `success` (bool).
	 * Coalesce reasoning to '' so a malformed row never crashes the row
	 * renderer with `undefined.length`. */
	const reasoning = decision.reasoning ?? "";
	const truncated = reasoning.length > 120 && !expanded;
	const displayReasoning = truncated ? `${reasoning.slice(0, 120)}...` : reasoning;
	const params = decisionParams(decision);
	const paramsLabel = JSON.stringify(params).slice(0, 80);
	const status = decisionStatus(decision);

	return (
		<tr className="hover:bg-gray-50">
			<td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
				{new Date(decision.timestamp).toLocaleString()}
			</td>
			<td className="px-4 py-3">
				<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
					{decision.toolName}
				</span>
			</td>
			<td className="px-4 py-3 text-sm text-gray-700">{paramsLabel}</td>
			<td className="px-4 py-3 text-sm text-gray-600 max-w-xs">
				<span>{displayReasoning}</span>
				{reasoning.length > 120 && (
					<button
						type="button"
						onClick={() => setExpanded(!expanded)}
						className="ml-1 text-blue-600 hover:text-blue-800 text-xs font-medium"
					>
						{expanded ? "Show less" : "Show more"}
					</button>
				)}
			</td>
			<td className="px-4 py-3">
				<span
					className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColors[status] ?? "bg-gray-100 text-gray-800"}`}
				>
					{status}
				</span>
			</td>
		</tr>
	);
}
