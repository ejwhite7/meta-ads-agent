/**
 * Campaigns page — overview table of all managed campaigns.
 *
 * Shows campaign name, status, daily budget, 7-day spend, ROAS,
 * CPA, impressions, and clicks. ROAS values are color-coded
 * (green above target, red below). Rows expand to show ad set details.
 */

import React, { useState } from "react";
import { useCampaigns } from "../hooks/useCampaigns";
import type { CampaignMetrics } from "../api/client";

/** Default ROAS target for color coding. */
const ROAS_TARGET = 4.0;

/**
 * Campaign overview page with expandable ad set breakdowns.
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
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>

      {campaigns.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No campaigns found.</p>
          <p className="text-sm mt-1">
            Campaigns will appear here once the agent starts managing them.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Campaign
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Daily Budget
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Spend (7d)
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ROAS (7d)
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  CPA (7d)
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Impressions
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Clicks
                </th>
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

/**
 * Expandable campaign table row with ad set breakdown.
 */
function CampaignRow({
  campaign,
}: {
  campaign: CampaignMetrics;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  const roasColor =
    campaign.roas7d >= ROAS_TARGET ? "text-green-600 font-semibold" : "text-red-600 font-semibold";

  return (
    <>
      <tr
        className="hover:bg-gray-50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3 text-sm font-medium text-gray-900">
          <span className="mr-2">{expanded ? "v" : ">"}</span>
          {campaign.name}
        </td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              campaign.status === "ACTIVE"
                ? "bg-green-100 text-green-800"
                : "bg-gray-100 text-gray-800"
            }`}
          >
            {campaign.status}
          </span>
        </td>
        <td className="px-4 py-3 text-sm text-gray-700 text-right">
          ${campaign.dailyBudget.toFixed(2)}
        </td>
        <td className="px-4 py-3 text-sm text-gray-700 text-right">
          ${campaign.spend7d.toFixed(2)}
        </td>
        <td className={`px-4 py-3 text-sm text-right ${roasColor}`}>
          {campaign.roas7d.toFixed(2)}
        </td>
        <td className="px-4 py-3 text-sm text-gray-700 text-right">
          ${campaign.cpa7d.toFixed(2)}
        </td>
        <td className="px-4 py-3 text-sm text-gray-700 text-right">
          {campaign.impressions7d.toLocaleString()}
        </td>
        <td className="px-4 py-3 text-sm text-gray-700 text-right">
          {campaign.clicks7d.toLocaleString()}
        </td>
      </tr>
      {expanded && campaign.adSets.length > 0 && (
        <>
          {campaign.adSets.map((adSet) => (
            <tr key={adSet.id} className="bg-gray-50">
              <td className="px-4 py-2 pl-10 text-sm text-gray-600">
                {adSet.name}
              </td>
              <td className="px-4 py-2">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                    adSet.status === "ACTIVE"
                      ? "bg-green-50 text-green-700"
                      : "bg-gray-50 text-gray-600"
                  }`}
                >
                  {adSet.status}
                </span>
              </td>
              <td className="px-4 py-2 text-sm text-gray-500 text-right">-</td>
              <td className="px-4 py-2 text-sm text-gray-600 text-right">
                ${adSet.spend7d.toFixed(2)}
              </td>
              <td
                className={`px-4 py-2 text-sm text-right ${
                  adSet.roas7d >= ROAS_TARGET
                    ? "text-green-600"
                    : "text-red-600"
                }`}
              >
                {adSet.roas7d.toFixed(2)}
              </td>
              <td className="px-4 py-2 text-sm text-gray-600 text-right">
                ${adSet.cpa7d.toFixed(2)}
              </td>
              <td className="px-4 py-2 text-sm text-gray-500 text-right">-</td>
              <td className="px-4 py-2 text-sm text-gray-500 text-right">-</td>
            </tr>
          ))}
        </>
      )}
    </>
  );
}
