import { DatabaseSync } from 'node:sqlite';

function normalizeMeta(result = {}) {
	return {
		changed_db: false,
		changes: Number(result.changes || 0),
		duration: 0,
		last_row_id: Number(result.lastInsertRowid || 0),
		rows_read: 0,
		rows_written: Number(result.changes || 0),
		size_after: 0
	};
}

class LocalD1PreparedStatement {
	constructor(database, query, params = []) {
		this.database = database;
		this.query = query;
		this.params = params;
	}

	bind(...params) {
		return new LocalD1PreparedStatement(this.database, this.query, params);
	}

	_statement() {
		return this.database.prepare(this.query);
	}

	async run() {
		const result = this._statement().run(...this.params);
		return {
			success: true,
			results: [],
			meta: normalizeMeta(result)
		};
	}

	async all() {
		const statement = this._statement();
		const results = statement.all(...this.params);
		return {
			success: true,
			results,
			meta: normalizeMeta()
		};
	}

	async first(columnName) {
		const row = this._statement().get(...this.params);
		if (!row) {
			return null;
		}
		return columnName ? row[columnName] : row;
	}

	async raw(options = {}) {
		const objectRows = this._statement().all(...this.params);
		const columns = objectRows[0] ? Object.keys(objectRows[0]) : [];
		const rows = objectRows.map(row => columns.map(column => row[column]));

		return options.columnNames ? [columns, ...rows] : rows;
	}

	async _batchResult() {
		const statement = this._statement();
		const normalizedQuery = this.query.trim().toLowerCase();
		const returnsRows =
			normalizedQuery.startsWith('select') ||
			normalizedQuery.startsWith('pragma') ||
			normalizedQuery.includes(' returning ');

		if (returnsRows) {
			const results = statement.all(...this.params);
			return {
				success: true,
				results,
				meta: normalizeMeta()
			};
		}

		const result = statement.run(...this.params);
		return {
			success: true,
			results: [],
			meta: normalizeMeta(result)
		};
	}
}

class LocalD1Database {
	constructor() {
		this.database = new DatabaseSync(':memory:');
		this.database.exec('PRAGMA foreign_keys = ON;');
	}

	prepare(query) {
		return new LocalD1PreparedStatement(this.database, query);
	}

	async batch(statements) {
		this.database.exec('BEGIN');
		try {
			const results = [];
			for (const statement of statements) {
				results.push(await statement._batchResult());
			}
			this.database.exec('COMMIT');
			return results;
		} catch (error) {
			this.database.exec('ROLLBACK');
			throw error;
		}
	}

	async exec(query) {
		this.database.exec(query);
		return {
			count: 1,
			duration: 0
		};
	}

	close() {
		this.database.close();
	}
}

class LocalKvNamespace {
	constructor() {
		this.values = new Map();
	}

	async put(key, value, options = {}) {
		this.values.set(key, {
			value,
			metadata: options.metadata ?? null,
			expiration: options.expiration ?? null,
			expirationTtl: options.expirationTtl ?? null
		});
	}

	async get(key, options = {}) {
		const entry = this.values.get(key);
		if (!entry) {
			return null;
		}

		const type = typeof options === 'string' ? options : options.type;
		if (type === 'json') {
			return typeof entry.value === 'string'
				? JSON.parse(entry.value)
				: entry.value;
		}
		if (type === 'arrayBuffer') {
			if (entry.value instanceof ArrayBuffer) {
				return entry.value;
			}
			if (ArrayBuffer.isView(entry.value)) {
				return entry.value.buffer.slice(
					entry.value.byteOffset,
					entry.value.byteOffset + entry.value.byteLength
				);
			}
			return new TextEncoder().encode(String(entry.value)).buffer;
		}
		return entry.value;
	}

	async getWithMetadata(key, options = {}) {
		const entry = this.values.get(key);
		if (!entry) {
			return {
				value: null,
				metadata: null
			};
		}
		return {
			value: await this.get(key, options),
			metadata: entry.metadata
		};
	}

	async delete(key) {
		this.values.delete(key);
	}

	async list(options = {}) {
		const keys = [...this.values.keys()]
			.filter(key => !options.prefix || key.startsWith(options.prefix))
			.map(name => ({ name }));
		return {
			keys,
			list_complete: true,
			cursor: ''
		};
	}
}

function createLocalCloudflareEnvironment() {
	return {
		db: new LocalD1Database(),
		kv: new LocalKvNamespace(),
		domain: ['example.test'],
		admin: 'admin@example.test',
		jwt_secret: 'vitest-local-only-secret',
		project_link: false,
		orm_log: false
	};
}

function createExecutionContext() {
	const promises = [];
	return {
		promises,
		waitUntil(promise) {
			promises.push(Promise.resolve(promise));
		},
		passThroughOnException() {}
	};
}

export {
	LocalD1Database,
	LocalKvNamespace,
	createExecutionContext,
	createLocalCloudflareEnvironment
};