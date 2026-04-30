/**
 * @module cli/commands/datasets
 *
 * Dataset (pixel) management commands wrapping the `meta ads datasets` CLI
 * resource group. Supports full CRUD operations plus event data upload for
 * conversion tracking and offline event measurement.
 */

import type {
	Dataset,
	CreateDatasetParams,
	UpdateDatasetParams,
	DatasetUploadParams,
} from "../../types.js";
import type { CLIWrapper } from "../wrapper.js";

/**
 * Provides typed access to dataset (pixel) operations via the meta-ads CLI.
 * Datasets are Meta's conversion tracking mechanism, enabling measurement
 * of website events, app events, and offline conversions.
 *
 * @example
 * ```typescript
 * const datasets = new DatasetCommands(cliWrapper);
 * const pixel = await datasets.create("act_123456", { name: "Website Pixel" });
 * await datasets.upload(pixel.id, {
 *   data: [{ event_name: "Purchase", event_time: 1700000000, user_data: { em: "hash" } }],
 * });
 * ```
 */
export class DatasetCommands {
	constructor(private readonly cli: CLIWrapper) {}

	/**
	 * Lists all datasets for the specified ad account.
	 * Equivalent to `meta ads datasets list --account-id <id>`.
	 *
	 * @param adAccountId - Ad account ID (format: "act_XXXXXXXXX").
	 * @returns Array of datasets in the account.
	 */
	async list(adAccountId: string): Promise<Dataset[]> {
		return this.cli.run<Dataset[]>("datasets", "list", {
			"account-id": adAccountId,
		});
	}

	/**
	 * Retrieves a single dataset by ID.
	 * Equivalent to `meta ads datasets show --id <id>`.
	 *
	 * @param datasetId - Dataset ID to retrieve.
	 * @returns Dataset details.
	 * @throws {NotFoundError} If the dataset does not exist.
	 */
	async get(datasetId: string): Promise<Dataset> {
		return this.cli.run<Dataset>("datasets", "show", {
			id: datasetId,
		});
	}

	/**
	 * Creates a new dataset in the specified ad account.
	 * Equivalent to `meta ads datasets create`.
	 *
	 * @param adAccountId - Ad account ID to create the dataset in.
	 * @param params - Dataset creation parameters.
	 * @returns The newly created dataset.
	 */
	async create(adAccountId: string, params: CreateDatasetParams): Promise<Dataset> {
		return this.cli.run<Dataset>("datasets", "create", {
			"account-id": adAccountId,
			name: params.name,
		});
	}

	/**
	 * Updates an existing dataset.
	 * Equivalent to `meta ads datasets update --id <id>`.
	 *
	 * @param datasetId - Dataset ID to update.
	 * @param params - Fields to update.
	 * @returns The updated dataset.
	 * @throws {NotFoundError} If the dataset does not exist.
	 */
	async update(datasetId: string, params: UpdateDatasetParams): Promise<Dataset> {
		return this.cli.run<Dataset>("datasets", "update", {
			id: datasetId,
			...(params.name && { name: params.name }),
		});
	}

	/**
	 * Deletes a dataset by ID.
	 * Equivalent to `meta ads datasets delete --id <id>`.
	 *
	 * @param datasetId - Dataset ID to delete.
	 * @throws {NotFoundError} If the dataset does not exist.
	 */
	async delete(datasetId: string): Promise<void> {
		await this.cli.run("datasets", "delete", {
			id: datasetId,
			force: true,
		});
	}

	/**
	 * Uploads conversion event data to a dataset.
	 * Equivalent to `meta ads datasets upload --id <id>`.
	 *
	 * Used for offline conversion tracking, server-side event tracking,
	 * and CRM data integration with Meta's advertising platform.
	 *
	 * @param datasetId - Dataset ID to upload events to.
	 * @param params - Event data to upload.
	 * @returns Upload result with event processing status.
	 */
	async upload(datasetId: string, params: DatasetUploadParams): Promise<{ events_received: number }> {
		return this.cli.run<{ events_received: number }>("datasets", "upload", {
			id: datasetId,
			data: JSON.stringify(params.data),
		});
	}
}
