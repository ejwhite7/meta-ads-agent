/**
 * Configuration page — form editor for agent goals and settings.
 *
 * Allows editing:
 *   - Agent goals (ROAS target, CPA cap, daily budget limit, risk level)
 *   - LLM provider toggle (Claude / OpenAI)
 *   - Tick interval selector
 *   - Guardrail settings (min budget, max scale factor, approval threshold)
 */

import React, { useState } from "react";

/**
 * Risk level options for the agent.
 */
type RiskLevel = "conservative" | "moderate" | "aggressive";

/**
 * Tick interval options with display labels.
 */
const TICK_INTERVALS = [
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 60, label: "1 hour" },
  { value: 240, label: "4 hours" },
  { value: 1440, label: "24 hours" },
];

/**
 * Configuration state managed by the form.
 */
interface ConfigFormState {
  roasTarget: number;
  cpaCap: number;
  dailyBudgetLimit: number;
  riskLevel: RiskLevel;
  llmProvider: "claude" | "openai";
  tickIntervalMinutes: number;
  minBudget: number;
  maxScaleFactor: number;
  requireApprovalThreshold: number;
}

/**
 * Configuration editor page with save confirmation.
 */
export function Configuration(): React.ReactElement {
  const [config, setConfig] = useState<ConfigFormState>({
    roasTarget: 4.0,
    cpaCap: 25.0,
    dailyBudgetLimit: 500,
    riskLevel: "moderate",
    llmProvider: "claude",
    tickIntervalMinutes: 60,
    minBudget: 10,
    maxScaleFactor: 1.5,
    requireApprovalThreshold: 100,
  });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  /**
   * Update a single configuration field.
   */
  function updateField<K extends keyof ConfigFormState>(
    key: K,
    value: ConfigFormState[K],
  ): void {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  /**
   * Submit the configuration changes.
   */
  async function handleSave(): Promise<void> {
    setSaving(true);
    try {
      // Configuration is saved to the backend via the API.
      // For now this stores locally until the API endpoint is wired.
      localStorage.setItem("meta-ads-agent-config", JSON.stringify(config));
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900">Configuration</h1>

      {/* Agent Goals */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Agent Goals</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ROAS Target
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              value={config.roasTarget}
              onChange={(e) => updateField("roasTarget", parseFloat(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              CPA Cap ($)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={config.cpaCap}
              onChange={(e) => updateField("cpaCap", parseFloat(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Daily Budget Limit ($)
            </label>
            <input
              type="number"
              step="1"
              min="0"
              value={config.dailyBudgetLimit}
              onChange={(e) => updateField("dailyBudgetLimit", parseFloat(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Risk Level
            </label>
            <select
              value={config.riskLevel}
              onChange={(e) => updateField("riskLevel", e.target.value as RiskLevel)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="conservative">Conservative</option>
              <option value="moderate">Moderate</option>
              <option value="aggressive">Aggressive</option>
            </select>
          </div>
        </div>
      </section>

      {/* LLM Provider */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">LLM Provider</h2>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="llmProvider"
              value="claude"
              checked={config.llmProvider === "claude"}
              onChange={() => updateField("llmProvider", "claude")}
              className="text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-700">Claude (Anthropic)</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="llmProvider"
              value="openai"
              checked={config.llmProvider === "openai"}
              onChange={() => updateField("llmProvider", "openai")}
              className="text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-gray-700">GPT-4o (OpenAI)</span>
          </label>
        </div>
      </section>

      {/* Tick Interval */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Tick Interval</h2>
        <select
          value={config.tickIntervalMinutes}
          onChange={(e) => updateField("tickIntervalMinutes", parseInt(e.target.value, 10))}
          className="w-full sm:w-auto px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          {TICK_INTERVALS.map((interval) => (
            <option key={interval.value} value={interval.value}>
              {interval.label}
            </option>
          ))}
        </select>
      </section>

      {/* Guardrails */}
      <section className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Guardrails</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Minimum Budget ($)
            </label>
            <input
              type="number"
              step="1"
              min="0"
              value={config.minBudget}
              onChange={(e) => updateField("minBudget", parseFloat(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max Scale Factor
            </label>
            <input
              type="number"
              step="0.1"
              min="1"
              value={config.maxScaleFactor}
              onChange={(e) => updateField("maxScaleFactor", parseFloat(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Require Approval Above ($)
            </label>
            <input
              type="number"
              step="1"
              min="0"
              value={config.requireApprovalThreshold}
              onChange={(e) =>
                updateField("requireApprovalThreshold", parseFloat(e.target.value))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              Budget changes above this amount require manual approval.
            </p>
          </div>
        </div>
      </section>

      {/* Save button */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving..." : "Save Configuration"}
        </button>
        {saved && (
          <span className="text-sm text-green-600 font-medium">
            Configuration saved successfully.
          </span>
        )}
      </div>
    </div>
  );
}
