/**
 * @module db
 * Database connection factory for SQLite and PostgreSQL.
 *
 * Creates a Drizzle ORM database instance based on the DB_TYPE
 * environment variable. SQLite is used for local development and
 * single-user deployment; PostgreSQL for cloud/team environments.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

/**
 * Supported database backend types.
 */
export type DatabaseType = "sqlite" | "postgres";

/**
 * Configuration for creating a database connection.
 */
export interface DatabaseConfig {
	/** Database backend type */
	readonly type: DatabaseType;

	/** SQLite file path (required when type is "sqlite") */
	readonly sqlitePath?: string;

	/** PostgreSQL connection URL (required when type is "postgres") */
	readonly postgresUrl?: string;
}

/**
 * Wrapper interface for the database instance.
 * Provides a type-safe handle to the underlying Drizzle database.
 */
export interface DatabaseConnection {
	/** The Drizzle ORM database instance */
	readonly db: ReturnType<typeof drizzleSqlite>;

	/** The database backend type */
	readonly type: DatabaseType;

	/** Closes the database connection */
	close(): void;
}

/**
 * Creates a SQLite database connection.
 *
 * Ensures the directory for the SQLite file exists before creating
 * the database. Enables WAL mode for better concurrent read performance.
 *
 * @param filePath - Path to the SQLite database file
 * @returns Database connection wrapper
 */
function createSqliteConnection(filePath: string): DatabaseConnection {
	/* Ensure the directory exists */
	mkdirSync(dirname(filePath), { recursive: true });

	const sqlite = new Database(filePath);

	/* Enable WAL mode for better performance */
	sqlite.pragma("journal_mode = WAL");
	sqlite.pragma("foreign_keys = ON");

	const db = drizzleSqlite(sqlite, { schema });

	return {
		db,
		type: "sqlite",
		close: () => sqlite.close(),
	};
}

/**
 * Creates a database connection based on the provided configuration.
 *
 * Factory function that dispatches to the appropriate backend:
 * - "sqlite": Creates a local SQLite database via better-sqlite3
 * - "postgres": Creates a PostgreSQL connection via pg driver
 *
 * Note: PostgreSQL support requires the `pg` package to be installed.
 * The connection is created lazily to avoid importing unused drivers.
 *
 * @param config - Database configuration specifying the backend and connection details
 * @returns Database connection wrapper with the Drizzle ORM instance
 * @throws {Error} If required configuration is missing or the database type is unsupported
 */
export function createDatabase(config: DatabaseConfig): DatabaseConnection {
	switch (config.type) {
		case "sqlite": {
			const path = config.sqlitePath ?? "./data/agent.db";
			return createSqliteConnection(path);
		}

		case "postgres": {
			if (!config.postgresUrl) {
				throw new Error('PostgreSQL connection URL is required when DB_TYPE is "postgres"');
			}

			/*
			 * PostgreSQL support uses dynamic import to avoid loading the pg
			 * driver when SQLite is configured. This reduces startup time and
			 * avoids requiring pg as a hard dependency for local development.
			 *
			 * For PostgreSQL usage, create the connection asynchronously:
			 *
			 *   import { drizzle } from 'drizzle-orm/node-postgres';
			 *   import { Pool } from 'pg';
			 *   const pool = new Pool({ connectionString: config.postgresUrl });
			 *   const db = drizzle(pool, { schema });
			 *
			 * Since Drizzle's SQLite and Postgres APIs are structurally compatible
			 * for the operations we use (insert, select, where), the schema
			 * definitions work with both backends.
			 */
			throw new Error(
				"PostgreSQL support requires async initialization. " +
					"Use createDatabaseAsync() for PostgreSQL connections.",
			);
		}

		default:
			throw new Error(`Unsupported database type: ${config.type as string}`);
	}
}

/**
 * Creates a database connection asynchronously.
 *
 * Required for PostgreSQL connections which need async module loading.
 * Also supports SQLite for API consistency.
 *
 * @param config - Database configuration
 * @returns Promise resolving to a database connection wrapper
 */
export async function createDatabaseAsync(config: DatabaseConfig): Promise<DatabaseConnection> {
	if (config.type === "sqlite") {
		return createDatabase(config);
	}

	if (config.type === "postgres") {
		if (!config.postgresUrl) {
			throw new Error('PostgreSQL connection URL is required when DB_TYPE is "postgres"');
		}

		const { drizzle: drizzlePg } = await import("drizzle-orm/node-postgres");
		const pgModule = await import("pg");
		const Pool = pgModule.default?.Pool ?? pgModule.Pool;

		const pool = new Pool({ connectionString: config.postgresUrl });
		const db = drizzlePg(pool, { schema });

		return {
			db: db as unknown as ReturnType<typeof drizzleSqlite>,
			type: "postgres",
			close: () => {
				pool.end();
			},
		};
	}

	throw new Error(`Unsupported database type: ${config.type as string}`);
}

export { schema };
