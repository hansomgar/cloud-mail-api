import { and, eq, inArray, sql } from 'drizzle-orm';
import account from '../entity/account';
import accountArchive from '../entity/account-archive';
import orm from '../entity/orm';
import BizError from '../error/biz-error';
import emailService from './email-service';
import { isDel } from '../const/entity-const';

const ARCHIVE_RENAMED = 1;
const TYPE_DELETED = 'deleted';
const TYPE_RENAMED = 'renamed';

function integer(value, field, { optional = false, allowZero = false } = {}) {
	if (optional && (value === undefined || value === null || value === '')) return null;
	const number = Number(value);
	if (!Number.isInteger(number) || (allowZero ? number < 0 : number <= 0)) {
		throw new BizError(`${field} must be a valid integer`, 400);
	}
	return number;
}

function archiveType(value) {
	if (!value) return '';
	if (![TYPE_DELETED, TYPE_RENAMED].includes(value)) {
		throw new BizError('archiveType must be deleted or renamed', 400);
	}
	return value;
}

function branchFilters(params, userId, adminMode, emailAlias, userAlias) {
	const conditions = [];
	const values = [];
	if (!adminMode) {
		conditions.push(`${emailAlias}.user_id = ?`);
		values.push(userId);
	} else if (params.userId) {
		conditions.push(`${emailAlias}.user_id = ?`);
		values.push(integer(params.userId, 'userId'));
	}
	if (params.email) {
		conditions.push(`${emailAlias}.email COLLATE NOCASE LIKE ?`);
		values.push(`%${String(params.email).trim()}%`);
	}
	if (adminMode && params.userEmail) {
		conditions.push(`${userAlias}.email COLLATE NOCASE LIKE ?`);
		values.push(`%${String(params.userEmail).trim()}%`);
	}
	return { conditions, values };
}

function publicRow(row) {
	return {
		archiveType: row.archive_type,
		archiveId: row.archive_id,
		accountId: row.account_id,
		userId: row.user_id,
		primaryEmail: row.primary_email,
		email: row.email,
		name: row.name,
		currentEmail: row.current_email,
		currentName: row.current_name,
		archiveTime: row.archive_time
	};
}

async function emailIdsForAddress(c, row) {
	const { results } = await c.env.db
		.prepare(`
			SELECT email_id
			FROM email
			WHERE user_id = ?
			  AND account_id = ?
			  AND (
				to_email COLLATE NOCASE = ?
				OR send_email COLLATE NOCASE = ?
			  )
		`)
		.bind(row.userId, row.accountId, row.email, row.email)
		.all();
	return results.map(item => item.email_id);
}

async function deleteEmailIds(c, ids) {
	if (!ids.length) return;
	await emailService.physicsDelete(c, { emailIds: ids.join(',') });
}

const accountArchiveService = {
	ARCHIVE_RENAMED,

	selectByEmail(c, email) {
		return orm(c)
			.select()
			.from(accountArchive)
			.where(sql`${accountArchive.email} COLLATE NOCASE = ${email}`)
			.get();
	},

	async consume(c, row, targetAccountId) {
		if (!row) return;
		if (Number(row.accountId) !== Number(targetAccountId)) {
			await c.env.db.batch([
				c.env.db.prepare(`
					UPDATE attachments
					SET account_id = ?
					WHERE email_id IN (
						SELECT email_id
						FROM email
						WHERE user_id = ?
						  AND account_id = ?
						  AND (
							to_email COLLATE NOCASE = ?
							OR send_email COLLATE NOCASE = ?
						  )
					)
				`).bind(
					targetAccountId,
					row.userId,
					row.accountId,
					row.email,
					row.email
				),
				c.env.db.prepare(`
					UPDATE email
					SET account_id = ?
					WHERE user_id = ?
					  AND account_id = ?
					  AND (
						to_email COLLATE NOCASE = ?
						OR send_email COLLATE NOCASE = ?
					  )
				`).bind(
					targetAccountId,
					row.userId,
					row.accountId,
					row.email,
					row.email
				),
				c.env.db.prepare(`
					DELETE FROM account_archive
					WHERE archive_id = ? AND user_id = ?
				`).bind(row.archiveId, row.userId)
			]);
		} else {
			await orm(c)
				.delete(accountArchive)
				.where(and(
					eq(accountArchive.archiveId, row.archiveId),
					eq(accountArchive.userId, row.userId)
				))
				.run();
		}
	},

	async list(c, params = {}, userId = null, options = {}) {
		const adminMode = options.adminMode === true;
		const type = archiveType(params.archiveType);
		const limit = Math.min(integer(params.limit || 20, 'limit'), 100);
		const offset = integer(params.cursor || 0, 'cursor', { allowZero: true });
		const branches = [];
		const values = [];

		if (!type || type === TYPE_DELETED) {
			const filter = branchFilters(params, userId, adminMode, 'a', 'u');
			branches.push(`
				SELECT
					'deleted' AS archive_type,
					a.account_id AS archive_id,
					a.account_id AS account_id,
					a.user_id AS user_id,
					u.email AS primary_email,
					a.email AS email,
					a.name AS name,
					NULL AS current_email,
					NULL AS current_name,
					COALESCE(a.archive_time, a.create_time) AS archive_time
				FROM account a
				JOIN user u ON u.user_id = a.user_id
				WHERE a.is_del = 1
				  AND a.email COLLATE NOCASE <> u.email
				  ${filter.conditions.length ? `AND ${filter.conditions.join(' AND ')}` : ''}
			`);
			values.push(...filter.values);
		}

		if (!type || type === TYPE_RENAMED) {
			const filter = branchFilters(params, userId, adminMode, 'ar', 'u');
			branches.push(`
				SELECT
					'renamed' AS archive_type,
					ar.archive_id AS archive_id,
					ar.account_id AS account_id,
					ar.user_id AS user_id,
					u.email AS primary_email,
					ar.email AS email,
					ar.name AS name,
					a.email AS current_email,
					a.name AS current_name,
					ar.create_time AS archive_time
				FROM account_archive ar
				JOIN user u ON u.user_id = ar.user_id
				LEFT JOIN account a ON a.account_id = ar.account_id
				WHERE ar.archive_type = ${ARCHIVE_RENAMED}
				  ${filter.conditions.length ? `AND ${filter.conditions.join(' AND ')}` : ''}
			`);
			values.push(...filter.values);
		}

		const union = branches.join(' UNION ALL ');
		const [{ results }, totalRow] = await Promise.all([
			c.env.db
				.prepare(`
					SELECT *
					FROM (${union})
					ORDER BY archive_time DESC, archive_type, archive_id DESC
					LIMIT ? OFFSET ?
				`)
				.bind(...values, limit + 1, offset)
				.all(),
			c.env.db
				.prepare(`SELECT COUNT(*) AS total FROM (${union})`)
				.bind(...values)
				.first()
		]);
		const hasMore = results.length > limit;
		return {
			items: results.slice(0, limit).map(publicRow),
			total: Number(totalRow?.total || 0),
			nextCursor: hasMore ? offset + limit : null
		};
	},

	async permanentDelete(c, params, actorUserId = null, options = {}) {
		const adminMode = options.adminMode === true;
		const source = Array.isArray(params) ? params : params?.items;
		if (!Array.isArray(source) || !source.length || source.length > 100) {
			throw new BizError('items must contain between 1 and 100 archives', 400);
		}
		const unique = new Map();
		for (const item of source) {
			const type = archiveType(item?.archiveType);
			if (!type) throw new BizError('archiveType is required', 400);
			const id = integer(item.archiveId, 'archiveId');
			unique.set(`${type}:${id}`, { archiveType: type, archiveId: id });
		}
		const records = [];
		for (const item of unique.values()) {
			if (item.archiveType === TYPE_DELETED) {
				const row = await c.env.db.prepare(`
					SELECT
						a.account_id AS accountId,
						a.user_id AS userId,
						a.email AS email,
						a.name AS name,
						u.email AS primaryEmail
					FROM account a
					JOIN user u ON u.user_id = a.user_id
					WHERE a.account_id = ? AND a.is_del = 1
				`).bind(item.archiveId).first();
				if (
					!row ||
					row.email.toLowerCase() === row.primaryEmail.toLowerCase() ||
					(!adminMode && Number(row.userId) !== Number(actorUserId))
				) {
					throw new BizError('Archived account not found', 404);
				}
				records.push({ ...item, ...row });
			} else {
				const row = await orm(c)
					.select()
					.from(accountArchive)
					.where(eq(accountArchive.archiveId, item.archiveId))
					.get();
				if (!row || (!adminMode && Number(row.userId) !== Number(actorUserId))) {
					throw new BizError('Archived account not found', 404);
				}
				records.push({
					...item,
					userId: row.userId,
					accountId: row.accountId,
					email: row.email
				});
			}
		}

		for (const row of records) {
			if (row.archiveType === TYPE_DELETED) {
				const { results } = await c.env.db
					.prepare(`SELECT email_id FROM email WHERE account_id = ?`)
					.bind(row.accountId)
					.all();
				await deleteEmailIds(c, results.map(item => item.email_id));
				await c.env.db.batch([
					c.env.db.prepare(`DELETE FROM account_archive WHERE account_id = ?`)
						.bind(row.accountId),
					c.env.db.prepare(`DELETE FROM account WHERE account_id = ? AND is_del = 1`)
						.bind(row.accountId)
				]);
			} else {
				await deleteEmailIds(c, await emailIdsForAddress(c, row));
				await orm(c)
					.delete(accountArchive)
					.where(eq(accountArchive.archiveId, row.archiveId))
					.run();
			}
		}
		return { deleted: records.length };
	},

	async deleteByAccountId(c, accountId) {
		await orm(c)
			.delete(accountArchive)
			.where(eq(accountArchive.accountId, accountId))
			.run();
	},

	async deleteByUserIds(c, userIds) {
		if (!userIds.length) return;
		await orm(c)
			.delete(accountArchive)
			.where(inArray(accountArchive.userId, userIds))
			.run();
	}
};

export default accountArchiveService;