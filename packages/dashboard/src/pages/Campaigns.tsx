/**
 * Campaigns page — hierarchical campaign / ad set / ad view.
 *
 * Pulls the live Meta hierarchy from the backend (`GET /api/campaigns`),
 * which returns campaigns -> adSets -> ads with 7-day metrics from
 * Insights and the active goal joined per campaign.
 *
 * UI contract:
 *   - Each campaign row is expandable. Expanding shows ad sets;
 *     ad sets are themselves expandable to show ads.
 *   - The Goal column shows the configured KPI/target if a goal
 *     exists; otherwise a "Configure" link to /goals.
 *   - ROAS color coding uses the per-campaign goal target when the
 *     primary KPI is roas; otherwise neutral.
 */

import type React from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { AdMetricsRow, AdSetMetricsRow, CampaignGoal, CampaignMetrics } from "../api/client";
import { useCampaigns } from "../hooks/useCampaigns";

/**
 * Color a ROAS cell against the campaign's ROAS target if it has one.
 * Returns a Tailwind class for the cell.
 */
function roasColor(value: number, goal: CampaignGoal | null): string {
	if (!goal || goal.primaryKpi !== "roas") return "text-gray-700";
	const meets =
		goal.primaryKpiDirection === "maximize"
			? value >= goal.primaryKpiTarget
			: value <= goal.primaryKpiTarget;
	return meets ? "text-green-600 font-semibold" : "text-red-600 font-semibold";
}

/**
 * Color a CPA cell against the campaign's CPA cap if its primary KPI
 * is cpa/cpl/cpc/etc. (lower is better). Falls back to neutral.
 */
function lowerIsBetterColor(value: number, goal: CampaignGoal | null, kpi: string): string {
	if (!goal || goal.primaryKpi !== kpi || value === 0) return "text-gray-700";
	return value <= goal.primaryKpiTarget
		? "text-green-600 font-semibold"
		: "text-red-600 font-semibold";
}

function StatusBadge({ status }: { status: string }): React.ReactElement {
	const isActive = status === "ACTIVE";
	return (
		<span
			className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
				isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
			}`}
		>
			{status}
		</span>
	);
}

/**
 * Goal cell renderer — either the configured KPI/target or a Configure link.
 */
function GoalCell({
	goal,
	campaignId,
}: {
	goal: CampaignGoal | null;
	campaignId: string;
}): React.ReactElement {
	if (!goal) {
		return (
			<Link
				to="/goals"
				state={{ focusCampaignId: campaignId }}
				className="text-sm text-blue-600 hover:text-blue-700 underline underline-offset-2"
			>
				Configure
			</Link>
		);
	}
	const arrow = goal.primaryKpiDirection === "maximize" ? "↑" : "↓";
	return (
		<span className="text-sm text-gray-700">
			<span className="uppercase font-medium">{goal.primaryKpi}</span>{" "}
			<span className="text-xs text-gray-400">{arrow}</span>{" "}
			<span className="font-mono">{goal.primaryKpiTarget}</span>
		</span>
	);
}

/**
 * Campaigns table page.
 */
export function Campaigns(): React.ReactElement {
	const { campaigns, loading, error } = useCampaigns();

	if (loading) {
		return (
			<div className="space-y-6">
				<h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
				<div className="flex items-center justify-center h-32">
					<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="space-y-6">
				<h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
				<div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
					<p className="font-medium mb-1">Failed to load campaigns from Meta.</p>
					<p>{error}</p>
					<p className="mt-2 text-xs text-red-700">
						If the access token is invalid or expired, run{" "}
						<code className="font-mono">meta-ads-agent init</code> to reauthorize. Otherwise the
						Meta Marketing API may be temporarily unavailable; refresh in a minute.
					</p>
				</div>
			</div>
		);
	}

	const noGoalCount = campaigns.filter((c) => c.goal === null).length;

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
				{noGoalCount > 0 && (
					<Link to="/goals" className="text-sm font-medium text-blue-600 hover:text-blue-700">
						{noGoalCount} campaign{noGoalCount === 1 ? "" : "s"} need a goal →
					</Link>
				)}
			</div>

			{campaigns.length === 0 ? (
				<div className="text-center py-12 text-gray-500">
					<p className="text-lg">No campaigns found in this ad account.</p>
					<p className="text-sm mt-1">
						Create one in Meta Ads Manager and refresh this page — it'll show up here.
					</p>
				</div>
			) : (
				<div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
					<table className="min-w-full divide-y divide-gray-200">
						<thead className="bg-gray-50">
							<tr>
								<Th>Campaign</Th>
								<Th>Status</Th>
								<Th>Objective</Th>
								<Th>Goal</Th>
								<Th align="right">Daily Budget</Th>
								<Th align="right">Spend</Th>
								<Th align="right">ROAS</Th>
								<Th align="right">CPA</Th>
								<Th align="right">Impressions</Th>
								<Th align="right">Clicks</Th>
							</tr>
						</thead>
						<tbody className="bg-white divide-y divide-gray-200">
							{campaigns.map((campaign) => (
								<CampaignRow key={campaign.id} campaign={campaign} />
							))}
						</tbody>
					</table>
				</div>
			)}
		</div>
	);
}

function CampaignRow({ campaign }: { campaign: CampaignMetrics }): React.ReactElement {
	const [expanded, setExpanded] = useState(false);

	return (
		<>
			<tr
				className="hover:bg-gray-50 cursor-pointer"
				onClick={() => setExpanded(!expanded)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						setExpanded(!expanded);
					}
				}}
				tabIndex={0}
			>
				<td className="px-4 py-3 text-sm font-medium text-gray-900">
					<span className="mr-2 text-gray-400">{expanded ? "▾" : "▸"}</span>
					{campaign.name}
					<div className="text-xs text-gray-400 font-mono ml-5">{campaign.id}</div>
				</td>
				<td className="px-4 py-3">
					<StatusBadge status={campaign.status} />
				</td>
				<td className="px-4 py-3 text-sm text-gray-700">{campaign.objective}</td>
				<td className="px-4 py-3">
					<GoalCell goal={campaign.goal} campaignId={campaign.id} />
				</td>
				<td className="px-4 py-3 text-sm text-gray-700 text-right">
					${campaign.dailyBudget.toFixed(2)}
				</td>
				<td className="px-4 py-3 text-sm text-gray-700 text-right">
					${campaign.spend7d.toFixed(2)}
				</td>
				<td className={`px-4 py-3 text-sm text-right ${roasColor(campaign.roas7d, campaign.goal)}`}>
					{campaign.roas7d.toFixed(2)}
				</td>
				<td
					className={`px-4 py-3 text-sm text-right ${lowerIsBetterColor(
						campaign.cpa7d,
						campaign.goal,
						"cpa",
					)}`}
				>
					${campaign.cpa7d.toFixed(2)}
				</td>
				<td className="px-4 py-3 text-sm text-gray-700 text-right">
					{campaign.impressions7d.toLocaleString()}
				</td>
				<td className="px-4 py-3 text-sm text-gray-700 text-right">
					{campaign.clicks7d.toLocaleString()}
				</td>
			</tr>
			{expanded && campaign.adSets.length === 0 && (
				<tr className="bg-gray-50">
					<td className="px-4 py-2 pl-10 text-xs text-gray-500" colSpan={10}>
						No ad sets in this campaign yet.
					</td>
				</tr>
			)}
			{expanded &&
				campaign.adSets.map((adSet) => (
					<AdSetRow key={adSet.id} adSet={adSet} goal={campaign.goal} />
				))}
		</>
	);
}

function AdSetRow({
	adSet,
	goal,
}: {
	adSet: AdSetMetricsRow;
	goal: CampaignGoal | null;
}): React.ReactElement {
	const [expanded, setExpanded] = useState(false);
	return (
		<>
			<tr
				className="bg-gray-50 hover:bg-gray-100 cursor-pointer"
				onClick={() => setExpanded(!expanded)}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						setExpanded(!expanded);
					}
				}}
				tabIndex={0}
			>
				<td className="px-4 py-2 pl-10 text-sm text-gray-700">
					<span className="mr-2 text-gray-400">{expanded ? "▾" : "▸"}</span>
					{adSet.name}
					<div className="text-xs text-gray-400 font-mono ml-5">{adSet.id}</div>
				</td>
				<td className="px-4 py-2">
					<StatusBadge status={adSet.status} />
				</td>
				<td className="px-4 py-2 text-xs text-gray-400">—</td>
				<td className="px-4 py-2 text-xs text-gray-400">—</td>
				<td className="px-4 py-2 text-sm text-gray-600 text-right">
					${adSet.dailyBudget.toFixed(2)}
				</td>
				<td className="px-4 py-2 text-sm text-gray-600 text-right">${adSet.spend7d.toFixed(2)}</td>
				<td className={`px-4 py-2 text-sm text-right ${roasColor(adSet.roas7d, goal)}`}>
					{adSet.roas7d.toFixed(2)}
				</td>
				<td
					className={`px-4 py-2 text-sm text-right ${lowerIsBetterColor(adSet.cpa7d, goal, "cpa")}`}
				>
					${adSet.cpa7d.toFixed(2)}
				</td>
				<td className="px-4 py-2 text-sm text-gray-600 text-right">
					{adSet.impressions7d.toLocaleString()}
				</td>
				<td className="px-4 py-2 text-sm text-gray-600 text-right">
					{adSet.clicks7d.toLocaleString()}
				</td>
			</tr>
			{expanded && adSet.ads.length === 0 && (
				<tr className="bg-gray-100">
					<td className="px-4 py-2 pl-16 text-xs text-gray-500" colSpan={10}>
						No ads in this ad set.
					</td>
				</tr>
			)}
			{expanded && adSet.ads.map((ad) => <AdRow key={ad.id} ad={ad} goal={goal} />)}
		</>
	);
}

function AdRow({ ad, goal }: { ad: AdMetricsRow; goal: CampaignGoal | null }): React.ReactElement {
	return (
		<tr className="bg-gray-100">
			<td className="px-4 py-2 pl-16 text-sm text-gray-600">
				{ad.name}
				<div className="text-xs text-gray-400 font-mono ml-0">{ad.id}</div>
			</td>
			<td className="px-4 py-2">
				<StatusBadge status={ad.status} />
			</td>
			<td className="px-4 py-2 text-xs text-gray-400">—</td>
			<td className="px-4 py-2 text-xs text-gray-400">—</td>
			<td className="px-4 py-2 text-xs text-gray-400 text-right">—</td>
			<td className="px-4 py-2 text-sm text-gray-600 text-right">${ad.spend7d.toFixed(2)}</td>
			<td className={`px-4 py-2 text-sm text-right ${roasColor(ad.roas7d, goal)}`}>
				{ad.roas7d.toFixed(2)}
			</td>
			<td className={`px-4 py-2 text-sm text-right ${lowerIsBetterColor(ad.cpa7d, goal, "cpa")}`}>
				${ad.cpa7d.toFixed(2)}
			</td>
			<td className="px-4 py-2 text-sm text-gray-600 text-right">
				{ad.impressions7d.toLocaleString()}
			</td>
			<td className="px-4 py-2 text-sm text-gray-600 text-right">{ad.clicks7d.toLocaleString()}</td>
		</tr>
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
