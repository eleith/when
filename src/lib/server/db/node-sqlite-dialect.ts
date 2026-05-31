// Vendored from eleith/luzzle@e0a054e (packages/core/src/database/NodeSqliteDialect.ts).
// A minimal Kysely dialect over Node's built-in `node:sqlite` (DatabaseSync), so we
// don't need a native SQLite addon. Takes a constructed DatabaseSync instance.
import {
	CompiledQuery,
	type DatabaseConnection,
	type DatabaseIntrospector,
	type Dialect,
	type DialectAdapter,
	type Driver,
	type Kysely,
	type QueryCompiler,
	type QueryResult,
	SqliteAdapter,
	SqliteIntrospector,
	SqliteQueryCompiler
} from 'kysely';
import type { DatabaseSync } from 'node:sqlite';

export interface NodeSqliteDialectConfig {
	database: DatabaseSync;
}

class NodeSqliteConnection implements DatabaseConnection {
	readonly #db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.#db = db;
	}

	async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
		const stmt = this.#db.prepare(compiledQuery.sql);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const params = compiledQuery.parameters as any[];

		const isRead =
			/^\s*(?:select|pragma|explain)\b/i.test(compiledQuery.sql) ||
			/\breturning\b/i.test(compiledQuery.sql);

		if (isRead) {
			const rows = stmt.all(...params) as R[];
			return { rows };
		} else {
			const result = stmt.run(...params);
			return {
				numAffectedRows: BigInt(result.changes),
				insertId: BigInt(result.lastInsertRowid),
				rows: []
			};
		}
	}

	// eslint-disable-next-line require-yield
	async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
		throw new Error('NodeSqliteDialect does not support streaming');
	}
}

class NodeSqliteDriver implements Driver {
	readonly #config: NodeSqliteDialectConfig;

	constructor(config: NodeSqliteDialectConfig) {
		this.#config = config;
	}

	async init(): Promise<void> {}

	async acquireConnection(): Promise<DatabaseConnection> {
		return new NodeSqliteConnection(this.#config.database);
	}

	async beginTransaction(connection: DatabaseConnection): Promise<void> {
		await connection.executeQuery(CompiledQuery.raw('begin'));
	}

	async commitTransaction(connection: DatabaseConnection): Promise<void> {
		await connection.executeQuery(CompiledQuery.raw('commit'));
	}

	async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
		await connection.executeQuery(CompiledQuery.raw('rollback'));
	}

	async releaseConnection(): Promise<void> {}

	async destroy(): Promise<void> {
		this.#config.database.close();
	}
}

export class NodeSqliteDialect implements Dialect {
	readonly #config: NodeSqliteDialectConfig;

	constructor(config: NodeSqliteDialectConfig) {
		this.#config = config;
	}

	createAdapter(): DialectAdapter {
		return new SqliteAdapter();
	}

	createDriver(): Driver {
		return new NodeSqliteDriver(this.#config);
	}

	createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
		return new SqliteIntrospector(db);
	}

	createQueryCompiler(): QueryCompiler {
		return new SqliteQueryCompiler();
	}
}
