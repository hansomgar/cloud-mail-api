import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const apiKey = sqliteTable('api_key', {
	apiKeyId: integer('api_key_id').primaryKey({ autoIncrement: true }),
	publicId: text('public_id').notNull(),
	userId: integer('user_id').notNull(),
	name: text('name').notNull(),
	keyHash: text('key_hash').notNull(),
	keyPrefix: text('key_prefix').notNull(),
	status: integer('status').default(0).notNull(),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`).notNull(),
	lastUsedTime: text('last_used_time'),
	revokeTime: text('revoke_time')
});

export default apiKey;