import { sql, type Kysely } from 'kysely';
import type { Database } from './types.js';

export async function withWriteTransaction<T>(
	db: Kysely<Database>,
	write: (connection: Kysely<Database>) => Promise<T>
): Promise<T> {
	const result = await db.connection().execute(async (connection) => {
		await sql`BEGIN IMMEDIATE`.execute(connection);
		try {
			const value = await write(connection);
			await sql`COMMIT`.execute(connection);
			return value;
		} catch (error) {
			try {
				await sql`ROLLBACK`.execute(connection);
			} catch (rollbackError) {
				throw new AggregateError([error, rollbackError], 'Write transaction rollback failed', {
					// eslint-disable-next-line preserve-caught-error -- The write failure is primary; both errors are retained.
					cause: error
				});
			}
			throw error;
		}
	});
	return result;
}
