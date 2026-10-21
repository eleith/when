import { SqliteDialect, type SqliteDatabase, type SqliteStatement } from 'kysely';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

export interface NodeSqliteDialectConfig {
	database: DatabaseSync;
}

function adaptDatabase(database: DatabaseSync): SqliteDatabase {
	return {
		close: () => database.close(),
		prepare(sql): SqliteStatement {
			const statement = database.prepare(sql);
			return {
				reader: statement.columns().length > 0,
				all: (parameters) => statement.all(...(parameters as SQLInputValue[])),
				run: (parameters) => statement.run(...(parameters as SQLInputValue[])),
				iterate: (parameters) => statement.iterate(...(parameters as SQLInputValue[]))
			};
		}
	};
}

export class NodeSqliteDialect extends SqliteDialect {
	constructor(config: NodeSqliteDialectConfig) {
		// Native connection ownership keeps other requests out of an active transaction.
		super({ database: adaptDatabase(config.database) });
	}
}
