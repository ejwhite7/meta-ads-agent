/**
 * @module tools/reporting/send-slack-webhook
 *
 * Sends formatted messages to a Slack webhook URL using Slack's Block Kit
 * for rich formatting. Supports three message types:
 *
 * - **alert**: Red-accented header with a bullet list of anomalies
 * - **report**: Summary metrics displayed in structured section blocks
 * - **action_taken**: Green-accented header describing an agent action
 *
 * Uses the native `fetch` API (Node.js 18+) for HTTP requests.
 */

import { Type } from "@sinclair/typebox";
import { createTool } from "../types.js";

/**
 * TypeBox schema for send-slack-webhook parameters.
 */
const SendSlackWebhookParams = Type.Object({
	/** Slack incoming webhook URL. */
	webhookUrl: Type.String({
		description: "Slack incoming webhook URL (https://hooks.slack.com/services/...)",
	}),
	/** Message content to send. Can be a plain string or JSON-serialized object. */
	message: Type.String({
		description: "Message content: plain text, JSON-serialized PerformanceReport, or anomaly summary",
	}),
	/** Type of message, which determines the Slack Block Kit formatting. */
	type: Type.Union(
		[
			Type.Literal("report"),
			Type.Literal("alert"),
			Type.Literal("action_taken"),
		],
		{ description: "Message type: 'report' for metrics summary, 'alert' for anomaly warnings, 'action_taken' for agent actions" },
	),
});

/**
 * Slack Block Kit block type definitions (simplified).
 */
interface SlackBlock {
	type: string;
	text?: { type: string; text: string; emoji?: boolean };
	fields?: Array<{ type: string; text: string }>;
	elements?: Array<{ type: string; text: string }>;
}

/**
 * Tool that sends a formatted message to a Slack webhook URL.
 *
 * Formats the message as Slack Block Kit blocks based on the message type:
 * - `alert`: Red warning header with bullet-pointed anomaly list
 * - `report`: Performance summary in a structured metrics section
 * - `action_taken`: Green success header with action description
 *
 * @example
 * ```typescript
 * const result = await sendSlackWebhook.execute(
 *   {
 *     webhookUrl: "https://hooks.slack.com/services/T.../B.../xxx",
 *     message: JSON.stringify(anomalies),
 *     type: "alert",
 *   },
 *   context,
 * );
 * ```
 */
export const sendSlackWebhook = createTool({
	name: "send_slack_webhook",
	description:
		"Sends a formatted message to a Slack webhook URL using Block Kit formatting. " +
		"Supports 'alert' (red anomaly warnings), 'report' (metrics summary), and " +
		"'action_taken' (green action confirmation) message types.",
	parameters: SendSlackWebhookParams,
	async execute(params, _context): Promise<{ success: boolean; data: Record<string, unknown> | null; message: string }> {
		try {
			const blocks = buildSlackBlocks(params.message, params.type);

			const payload = {
				blocks,
				text: getFallbackText(params.message, params.type),
			};

			const response = await fetch(params.webhookUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				const responseText = await response.text();
				return {
					success: false,
					data: { error: responseText, statusCode: response.status },
					message: `Slack webhook failed with status ${response.status}: ${responseText}`,
				};
			}

			return {
				success: true,
				data: { delivered: true },
				message: `Slack ${params.type} message delivered successfully.`,
			};
		} catch (error) {
			const errMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				data: { error: errMessage },
				message: `Failed to send Slack webhook: ${errMessage}`,
			};
		}
	},
});

/**
 * Builds Slack Block Kit blocks based on the message type.
 *
 * @param message - Raw message content (may be JSON string).
 * @param type - Message type determining block formatting.
 * @returns Array of Slack blocks.
 */
function buildSlackBlocks(message: string, type: string): SlackBlock[] {
	switch (type) {
		case "alert":
			return buildAlertBlocks(message);
		case "report":
			return buildReportBlocks(message);
		case "action_taken":
			return buildActionTakenBlocks(message);
		default:
			return buildReportBlocks(message);
	}
}

/**
 * Builds alert-style blocks with a red warning header and bullet list.
 * Attempts to parse the message as JSON (array of anomalies); falls back
 * to plain text if parsing fails.
 */
function buildAlertBlocks(message: string): SlackBlock[] {
	const blocks: SlackBlock[] = [
		{
			type: "header",
			text: {
				type: "plain_text",
				text: "[ALERT] Performance Anomalies Detected",
				emoji: true,
			},
		},
		{
			type: "divider",
		} as SlackBlock,
	];

	try {
		const anomalies = JSON.parse(message);
		if (Array.isArray(anomalies)) {
			const bulletPoints = anomalies
				.map(
					(a: { severity?: string; type?: string; message?: string; recommendedAction?: string }) =>
						`${a.severity === "critical" ? "[CRITICAL]" : "[WARNING]"} *${a.type}*: ${a.message ?? "No details"}`,
				)
				.join("\n");

			blocks.push({
				type: "section",
				text: {
					type: "mrkdwn",
					text: bulletPoints,
				},
			});

			/* Add recommended actions */
			const actions = anomalies
				.filter((a: { recommendedAction?: string }) => a.recommendedAction)
				.map(
					(a: { type?: string; recommendedAction?: string }) =>
						`- *${a.type}*: ${a.recommendedAction}`,
				)
				.join("\n");

			if (actions) {
				blocks.push(
					{ type: "divider" } as SlackBlock,
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: `*Recommended Actions:*\n${actions}`,
						},
					},
				);
			}
		} else {
			blocks.push({
				type: "section",
				text: { type: "mrkdwn", text: message },
			});
		}
	} catch {
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: message },
		});
	}

	return blocks;
}

/**
 * Builds report-style blocks with a metrics summary section.
 * Attempts to parse the message as a PerformanceReport JSON; falls back
 * to displaying the raw message.
 */
function buildReportBlocks(message: string): SlackBlock[] {
	const blocks: SlackBlock[] = [
		{
			type: "header",
			text: {
				type: "plain_text",
				text: "Performance Report",
				emoji: true,
			},
		},
		{
			type: "divider",
		} as SlackBlock,
	];

	try {
		const report = JSON.parse(message);
		if (report.summary) {
			const { summary } = report;
			blocks.push({
				type: "section",
				fields: [
					{ type: "mrkdwn", text: `*Total Spend:*\n$${Number(summary.totalSpend).toFixed(2)}` },
					{ type: "mrkdwn", text: `*Total Impressions:*\n${Number(summary.totalImpressions).toLocaleString()}` },
					{ type: "mrkdwn", text: `*Total Clicks:*\n${Number(summary.totalClicks).toLocaleString()}` },
					{ type: "mrkdwn", text: `*Avg CTR:*\n${(Number(summary.avgCTR) * 100).toFixed(2)}%` },
					{ type: "mrkdwn", text: `*Avg ROAS:*\n${Number(summary.avgROAS).toFixed(2)}x` },
					{ type: "mrkdwn", text: `*Avg CPA:*\n$${Number(summary.avgCPA).toFixed(2)}` },
				],
			});

			if (report.dateRange) {
				blocks.push({
					type: "context",
					elements: [
						{
							type: "mrkdwn",
							text: `Period: ${report.dateRange.start} to ${report.dateRange.end}`,
						},
					],
				} as SlackBlock);
			}
		} else {
			blocks.push({
				type: "section",
				text: { type: "mrkdwn", text: message },
			});
		}
	} catch {
		blocks.push({
			type: "section",
			text: { type: "mrkdwn", text: message },
		});
	}

	return blocks;
}

/**
 * Builds action-taken-style blocks with a green success header.
 */
function buildActionTakenBlocks(message: string): SlackBlock[] {
	return [
		{
			type: "header",
			text: {
				type: "plain_text",
				text: "[ACTION TAKEN] Agent Update",
				emoji: true,
			},
		},
		{
			type: "divider",
		} as SlackBlock,
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: message,
			},
		},
	];
}

/**
 * Generates a plain-text fallback for Slack notifications (displayed
 * in push notifications and clients that don't support blocks).
 *
 * @param message - Raw message content.
 * @param type - Message type.
 * @returns Plain-text fallback string.
 */
function getFallbackText(message: string, type: string): string {
	switch (type) {
		case "alert":
			return `[ALERT] Performance anomalies detected. ${message.slice(0, 200)}`;
		case "report":
			return `Performance Report: ${message.slice(0, 200)}`;
		case "action_taken":
			return `[ACTION TAKEN] ${message.slice(0, 200)}`;
		default:
			return message.slice(0, 300);
	}
}
