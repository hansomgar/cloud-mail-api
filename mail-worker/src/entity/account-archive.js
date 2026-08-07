import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const accountArchive = sqliteTable('account_archive', {
	archiveId: integer('archive_id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull(),
	accountId: integer('account_id').notNull(),
	email: text('email').notNull(),
	name: text('name').notNull().default(''),
	archiveType: integer('archive_type').notNull().default(1),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`).notNull()
});

export default accountArchive;