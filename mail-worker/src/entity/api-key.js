import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const apiKey = sqliteTable('api_key', {
	apiKeyId: integer('api_key_id').primaryKey({ autoIncrement: true }),
	publicId: text('public_id').notNull(),
	userId: integer('user_id').notNull(),
	name: text('name').notNull(),
	keyPrefix: text('key_prefix').notNull(),
	apiKey: text('api_key').default('').notNull(),
	ipWhitelist: text('ip_whitelist').default('').notNull(),
	expireTime: text('expire_time'),
	isAdmin: integer('is_admin').default(0).notNull(),
	status: integer('status').default(0).notNull(),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`).notNull(),
	lastUsedTime: text('last_used_time'),
	lastUsedIp: text('last_used_ip').default('').notNull(),
	lastRequest: text('last_request').default('').notNull(),
	revokeTime: text('revoke_time')
});

export default apiKey;