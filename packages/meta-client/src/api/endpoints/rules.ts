/**
 * @module api/endpoints/rules
 *
 * Automated ad rules engine via the Meta Marketing API. Ad rules
 * automatically monitor campaign, ad set, or ad performance and take
 * actions (pause, unpause, adjust budget/bid, send notifications)
 * when specified conditions are met.
 *
 * These operations are not available through the meta-ads CLI and require
 * direct API calls.
 */

import type {
	AdRule,
	AdRulePreview,
	CreateRuleParams,
	UpdateRuleParams,
} from "../../types.js";
import type { ApiClient, ApiResponse } from "../client.js";

/**
 * Provides automated ad rule operations via direct Meta Marketing API calls.
 * Rules evaluate performance conditions on a schedule and execute actions
 * automatically (e.g., pause underperforming ads, scale winning campaigns).
 *
 * @example
 * ```typescript
 * const rules = new RulesEndpoints(apiClient);
 * const rule = await rules.create("act_123456", {
 *   name: "Pause high CPA ads",
 *   entity_type: "AD",
 *   evaluation_spec: {
 *     evaluation_type: "SCHEDULE",
 *     filters: [{ field: "cost_per_action_type", operator: "GREATER_THAN", value: 50 }],
 *   },
 *   execution_spec: { execution_type: "PAUSE" },
 *   schedule_spec: { schedule_type: "DAILY" },
 * });
 * ```
 */
export class RulesEndpoints {
	constructor(private readonly api: ApiClient) {}

	/**
	 * Lists all ad rules for the specified ad account.
	 *
	 * @param adAccountId - Ad account ID (format: "act_XXXXXXXXX").
	 * @returns Array of ad rules.
	 */
	async list(adAccountId: string): Promise<AdRule[]> {
		const response = await this.api.get<ApiResponse<AdRule[]>>(
			`/${adAccountId}/adrules_library`,
			{
				params: {
					fields:
						"id,name,status,evaluation_spec,execution_spec,schedule_spec,entity_type",
				},
			},
		);
		return response.data;
	}

	/**
	 * Creates a new automated ad rule.
	 *
	 * @param adAccountId - Ad account ID to create the rule in.
	 * @param params - Rule creation parameters including conditions and actions.
	 * @returns The newly created ad rule.
	 */
	async create(adAccountId: string, params: CreateRuleParams): Promise<AdRule> {
		return this.api.post<AdRule>(`/${adAccountId}/adrules_library`, {
			name: params.name,
			entity_type: params.entity_type,
			evaluation_spec: JSON.stringify(params.evaluation_spec),
			execution_spec: JSON.stringify(params.execution_spec),
			schedule_spec: JSON.stringify(params.schedule_spec),
		});
	}

	/**
	 * Updates an existing ad rule.
	 *
	 * @param ruleId - Rule ID to update.
	 * @param params - Fields to update.
	 * @returns The updated ad rule.
	 * @throws {NotFoundError} If the rule does not exist.
	 */
	async update(ruleId: string, params: UpdateRuleParams): Promise<AdRule> {
		return this.api.post<AdRule>(`/${ruleId}`, {
			...(params.name && { name: params.name }),
			...(params.status && { status: params.status }),
			...(params.evaluation_spec && {
				evaluation_spec: JSON.stringify(params.evaluation_spec),
			}),
			...(params.execution_spec && {
				execution_spec: JSON.stringify(params.execution_spec),
			}),
			...(params.schedule_spec && {
				schedule_spec: JSON.stringify(params.schedule_spec),
			}),
		});
	}

	/**
	 * Deletes an ad rule by ID.
	 *
	 * @param ruleId - Rule ID to delete.
	 * @throws {NotFoundError} If the rule does not exist.
	 */
	async delete(ruleId: string): Promise<void> {
		await this.api.delete(`/${ruleId}`);
	}

	/**
	 * Previews which entities (campaigns, ad sets, or ads) would be
	 * affected by a rule's current evaluation criteria without actually
	 * executing the rule. Useful for validating rule conditions before
	 * enabling them.
	 *
	 * @param ruleId - Rule ID to preview.
	 * @returns Preview showing matched entities and their current metrics.
	 * @throws {NotFoundError} If the rule does not exist.
	 */
	async previewRule(ruleId: string): Promise<AdRulePreview> {
		const response = await this.api.get<{
			data: Array<{
				id: string;
				name: string;
				entity_type: string;
				current_metrics: Record<string, string | number>;
			}>;
		}>(`/${ruleId}/preview`, {
			params: {
				fields: "id,name,entity_type",
			},
		});

		return {
			rule_id: ruleId,
			matched_entities: response.data ?? [],
		};
	}
}
