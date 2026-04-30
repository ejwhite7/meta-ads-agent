/**
 * @module cli/commands/catalogs
 *
 * Catalog management commands wrapping the `meta ads catalogs`, `product-sets`,
 * and `product-items` CLI resource groups. Provides full CRUD for product
 * catalogs, filtered product sets, and individual product items used in
 * dynamic advertising.
 */

import type {
	Catalog,
	CreateCatalogParams,
	CreateProductItemParams,
	CreateProductSetParams,
	ProductItem,
	ProductSet,
	UpdateCatalogParams,
	UpdateProductItemParams,
	UpdateProductSetParams,
} from "../../types.js";
import type { CLIWrapper } from "../wrapper.js";

/**
 * Provides typed access to catalog, product set, and product item operations
 * via the meta-ads CLI.
 *
 * @example
 * ```typescript
 * const catalogs = new CatalogCommands(cliWrapper);
 * const catalog = await catalogs.createCatalog("business_123", { name: "Summer Collection" });
 * const products = await catalogs.listProductItems(catalog.id);
 * ```
 */
export class CatalogCommands {
	constructor(private readonly cli: CLIWrapper) {}

	// -----------------------------------------------------------------------
	// Catalogs
	// -----------------------------------------------------------------------

	/**
	 * Lists all catalogs for the specified business.
	 * Equivalent to `meta ads catalogs list --account-id <id>`.
	 *
	 * @param adAccountId - Ad account or business ID.
	 * @returns Array of catalogs.
	 */
	async listCatalogs(adAccountId: string): Promise<Catalog[]> {
		return this.cli.run<Catalog[]>("catalogs", "list", {
			"account-id": adAccountId,
		});
	}

	/**
	 * Retrieves a single catalog by ID.
	 * Equivalent to `meta ads catalogs show --id <id>`.
	 *
	 * @param catalogId - Catalog ID to retrieve.
	 * @returns Catalog details.
	 * @throws {NotFoundError} If the catalog does not exist.
	 */
	async getCatalog(catalogId: string): Promise<Catalog> {
		return this.cli.run<Catalog>("catalogs", "show", {
			id: catalogId,
		});
	}

	/**
	 * Creates a new product catalog.
	 * Equivalent to `meta ads catalogs create`.
	 *
	 * @param adAccountId - Ad account or business ID.
	 * @param params - Catalog creation parameters.
	 * @returns The newly created catalog.
	 */
	async createCatalog(adAccountId: string, params: CreateCatalogParams): Promise<Catalog> {
		return this.cli.run<Catalog>("catalogs", "create", {
			"account-id": adAccountId,
			name: params.name,
			...(params.vertical && { vertical: params.vertical }),
		});
	}

	/**
	 * Updates an existing catalog.
	 * Equivalent to `meta ads catalogs update --id <id>`.
	 *
	 * @param catalogId - Catalog ID to update.
	 * @param params - Fields to update.
	 * @returns The updated catalog.
	 * @throws {NotFoundError} If the catalog does not exist.
	 */
	async updateCatalog(catalogId: string, params: UpdateCatalogParams): Promise<Catalog> {
		return this.cli.run<Catalog>("catalogs", "update", {
			id: catalogId,
			...(params.name && { name: params.name }),
		});
	}

	/**
	 * Deletes a catalog by ID.
	 * Equivalent to `meta ads catalogs delete --id <id>`.
	 *
	 * @param catalogId - Catalog ID to delete.
	 * @throws {NotFoundError} If the catalog does not exist.
	 */
	async deleteCatalog(catalogId: string): Promise<void> {
		await this.cli.run("catalogs", "delete", {
			id: catalogId,
			force: true,
		});
	}

	// -----------------------------------------------------------------------
	// Product Sets
	// -----------------------------------------------------------------------

	/**
	 * Lists all product sets in a catalog.
	 * Equivalent to `meta ads product-sets list --catalog-id <id>`.
	 *
	 * @param catalogId - Parent catalog ID.
	 * @returns Array of product sets.
	 */
	async listProductSets(catalogId: string): Promise<ProductSet[]> {
		return this.cli.run<ProductSet[]>("product-sets", "list", {
			"catalog-id": catalogId,
		});
	}

	/**
	 * Retrieves a single product set by ID.
	 * Equivalent to `meta ads product-sets show --id <id>`.
	 *
	 * @param productSetId - Product set ID to retrieve.
	 * @returns Product set details.
	 * @throws {NotFoundError} If the product set does not exist.
	 */
	async getProductSet(productSetId: string): Promise<ProductSet> {
		return this.cli.run<ProductSet>("product-sets", "show", {
			id: productSetId,
		});
	}

	/**
	 * Creates a new product set within a catalog.
	 * Equivalent to `meta ads product-sets create`.
	 *
	 * @param catalogId - Parent catalog ID.
	 * @param params - Product set creation parameters.
	 * @returns The newly created product set.
	 */
	async createProductSet(catalogId: string, params: CreateProductSetParams): Promise<ProductSet> {
		return this.cli.run<ProductSet>("product-sets", "create", {
			"catalog-id": catalogId,
			name: params.name,
			...(params.filter && { filter: JSON.stringify(params.filter) }),
		});
	}

	/**
	 * Updates an existing product set.
	 * Equivalent to `meta ads product-sets update --id <id>`.
	 *
	 * @param productSetId - Product set ID to update.
	 * @param params - Fields to update.
	 * @returns The updated product set.
	 * @throws {NotFoundError} If the product set does not exist.
	 */
	async updateProductSet(
		productSetId: string,
		params: UpdateProductSetParams,
	): Promise<ProductSet> {
		return this.cli.run<ProductSet>("product-sets", "update", {
			id: productSetId,
			...(params.name && { name: params.name }),
			...(params.filter && { filter: JSON.stringify(params.filter) }),
		});
	}

	/**
	 * Deletes a product set by ID.
	 * Equivalent to `meta ads product-sets delete --id <id>`.
	 *
	 * @param productSetId - Product set ID to delete.
	 * @throws {NotFoundError} If the product set does not exist.
	 */
	async deleteProductSet(productSetId: string): Promise<void> {
		await this.cli.run("product-sets", "delete", {
			id: productSetId,
			force: true,
		});
	}

	// -----------------------------------------------------------------------
	// Product Items
	// -----------------------------------------------------------------------

	/**
	 * Lists all product items in a catalog.
	 * Equivalent to `meta ads product-items list --catalog-id <id>`.
	 *
	 * @param catalogId - Parent catalog ID.
	 * @returns Array of product items.
	 */
	async listProductItems(catalogId: string): Promise<ProductItem[]> {
		return this.cli.run<ProductItem[]>("product-items", "list", {
			"catalog-id": catalogId,
		});
	}

	/**
	 * Retrieves a single product item by ID.
	 * Equivalent to `meta ads product-items show --id <id>`.
	 *
	 * @param productItemId - Product item ID to retrieve.
	 * @returns Product item details.
	 * @throws {NotFoundError} If the product item does not exist.
	 */
	async getProductItem(productItemId: string): Promise<ProductItem> {
		return this.cli.run<ProductItem>("product-items", "show", {
			id: productItemId,
		});
	}

	/**
	 * Creates a new product item within a catalog.
	 * Equivalent to `meta ads product-items create`.
	 *
	 * @param catalogId - Parent catalog ID.
	 * @param params - Product item creation parameters.
	 * @returns The newly created product item.
	 */
	async createProductItem(
		catalogId: string,
		params: CreateProductItemParams,
	): Promise<ProductItem> {
		return this.cli.run<ProductItem>("product-items", "create", {
			"catalog-id": catalogId,
			"retailer-id": params.retailer_id,
			name: params.name,
			url: params.url,
			"image-url": params.image_url,
			price: params.price,
			availability: params.availability,
			...(params.description && { description: params.description }),
		});
	}

	/**
	 * Updates an existing product item.
	 * Equivalent to `meta ads product-items update --id <id>`.
	 *
	 * @param productItemId - Product item ID to update.
	 * @param params - Fields to update.
	 * @returns The updated product item.
	 * @throws {NotFoundError} If the product item does not exist.
	 */
	async updateProductItem(
		productItemId: string,
		params: UpdateProductItemParams,
	): Promise<ProductItem> {
		return this.cli.run<ProductItem>("product-items", "update", {
			id: productItemId,
			...(params.name && { name: params.name }),
			...(params.description && { description: params.description }),
			...(params.url && { url: params.url }),
			...(params.image_url && { "image-url": params.image_url }),
			...(params.price && { price: params.price }),
			...(params.availability && { availability: params.availability }),
		});
	}

	/**
	 * Deletes a product item by ID.
	 * Equivalent to `meta ads product-items delete --id <id>`.
	 *
	 * @param productItemId - Product item ID to delete.
	 * @throws {NotFoundError} If the product item does not exist.
	 */
	async deleteProductItem(productItemId: string): Promise<void> {
		await this.cli.run("product-items", "delete", {
			id: productItemId,
			force: true,
		});
	}
}
