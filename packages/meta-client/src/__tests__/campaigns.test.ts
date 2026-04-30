/**
 * @module __tests__/campaigns
 *
 * Unit tests for the CampaignCommands class. Validates campaign CRUD
 * operations with a mocked CLIWrapper to verify correct argument passing,
 * response handling, and error propagation.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignCommands } from "../cli/commands/campaigns.js";
import type { CLIWrapper } from "../cli/wrapper.js";
import type { Campaign, CreateCampaignParams, UpdateCampaignParams } from "../types.js";

/**
 * Creates a mock CLIWrapper with a typed run method.
 */
function createMockCli(): CLIWrapper {
	return {
		run: vi.fn(),
		checkInstalled: vi.fn(),
		whoami: vi.fn(),
	} as unknown as CLIWrapper;
}

const mockCampaign: Campaign = {
	id: "campaign_123",
	name: "Test Campaign",
	status: "ACTIVE",
	objective: "OUTCOME_SALES",
	daily_budget: "5000",
	created_time: "2026-01-01T00:00:00Z",
	updated_time: "2026-01-15T12:00:00Z",
};

describe("CampaignCommands", () => {
	let cli: CLIWrapper;
	let campaigns: CampaignCommands;

	beforeEach(() => {
		cli = createMockCli();
		campaigns = new CampaignCommands(cli);
	});

	describe("list()", () => {
		it("calls CLI with correct resource, action, and account ID", async () => {
			vi.mocked(cli.run).mockResolvedValue([mockCampaign]);

			const result = await campaigns.list("act_123456");

			expect(cli.run).toHaveBeenCalledWith("campaigns", "list", {
				"account-id": "act_123456",
			});
			expect(result).toEqual([mockCampaign]);
		});

		it("returns empty array when no campaigns exist", async () => {
			vi.mocked(cli.run).mockResolvedValue([]);

			const result = await campaigns.list("act_123456");

			expect(result).toEqual([]);
		});
	});

	describe("get()", () => {
		it("calls CLI with correct campaign ID", async () => {
			vi.mocked(cli.run).mockResolvedValue(mockCampaign);

			const result = await campaigns.get("campaign_123");

			expect(cli.run).toHaveBeenCalledWith("campaigns", "show", {
				id: "campaign_123",
			});
			expect(result).toEqual(mockCampaign);
		});

		it("propagates NotFoundError from CLI", async () => {
			const error = new Error("Campaign not found");
			vi.mocked(cli.run).mockRejectedValue(error);

			await expect(campaigns.get("nonexistent")).rejects.toThrow("Campaign not found");
		});
	});

	describe("create()", () => {
		it("passes all required parameters to CLI", async () => {
			vi.mocked(cli.run).mockResolvedValue(mockCampaign);

			const params: CreateCampaignParams = {
				name: "New Campaign",
				objective: "OUTCOME_SALES",
			};

			await campaigns.create("act_123456", params);

			expect(cli.run).toHaveBeenCalledWith("campaigns", "create", {
				"account-id": "act_123456",
				name: "New Campaign",
				objective: "OUTCOME_SALES",
			});
		});

		it("passes optional parameters when provided", async () => {
			vi.mocked(cli.run).mockResolvedValue(mockCampaign);

			const params: CreateCampaignParams = {
				name: "New Campaign",
				objective: "OUTCOME_SALES",
				status: "PAUSED",
				daily_budget: "5000",
				bid_strategy: "LOWEST_COST_WITHOUT_CAP",
				special_ad_categories: ["HOUSING", "EMPLOYMENT"],
			};

			await campaigns.create("act_123456", params);

			expect(cli.run).toHaveBeenCalledWith("campaigns", "create", {
				"account-id": "act_123456",
				name: "New Campaign",
				objective: "OUTCOME_SALES",
				status: "PAUSED",
				"daily-budget": "5000",
				"bid-strategy": "LOWEST_COST_WITHOUT_CAP",
				"special-ad-categories": "HOUSING,EMPLOYMENT",
			});
		});

		it("omits undefined optional parameters", async () => {
			vi.mocked(cli.run).mockResolvedValue(mockCampaign);

			await campaigns.create("act_123456", {
				name: "Minimal Campaign",
				objective: "OUTCOME_TRAFFIC",
			});

			const callArgs = vi.mocked(cli.run).mock.calls[0][2] as Record<string, unknown>;
			expect(callArgs).not.toHaveProperty("status");
			expect(callArgs).not.toHaveProperty("daily-budget");
			expect(callArgs).not.toHaveProperty("lifetime-budget");
		});
	});

	describe("update()", () => {
		it("passes campaign ID and update parameters to CLI", async () => {
			vi.mocked(cli.run).mockResolvedValue(mockCampaign);

			const params: UpdateCampaignParams = {
				name: "Updated Name",
				status: "PAUSED",
				daily_budget: "10000",
			};

			await campaigns.update("campaign_123", params);

			expect(cli.run).toHaveBeenCalledWith("campaigns", "update", {
				id: "campaign_123",
				name: "Updated Name",
				status: "PAUSED",
				"daily-budget": "10000",
			});
		});

		it("only includes provided update fields", async () => {
			vi.mocked(cli.run).mockResolvedValue(mockCampaign);

			await campaigns.update("campaign_123", { status: "ACTIVE" });

			const callArgs = vi.mocked(cli.run).mock.calls[0][2] as Record<string, unknown>;
			expect(callArgs.id).toBe("campaign_123");
			expect(callArgs.status).toBe("ACTIVE");
			expect(callArgs).not.toHaveProperty("name");
			expect(callArgs).not.toHaveProperty("daily-budget");
		});
	});

	describe("delete()", () => {
		it("calls CLI delete with force flag", async () => {
			vi.mocked(cli.run).mockResolvedValue(undefined);

			await campaigns.delete("campaign_123");

			expect(cli.run).toHaveBeenCalledWith("campaigns", "delete", {
				id: "campaign_123",
				force: true,
			});
		});

		it("propagates errors from CLI", async () => {
			vi.mocked(cli.run).mockRejectedValue(new Error("Delete failed"));

			await expect(campaigns.delete("campaign_123")).rejects.toThrow("Delete failed");
		});
	});
});
