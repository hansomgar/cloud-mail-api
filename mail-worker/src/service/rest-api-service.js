import { and, asc, count, desc, eq, gt, gte, inArray, like, lt, lte, sql } from 'drizzle-orm';
import dayjs from 'dayjs';
import account from '../entity/account';
import { att } from '../entity/att';
import email from '../entity/email';
import user from '../entity/user';
import orm from '../entity/orm';
import BizError from '../error/biz-error';
import { accountConst, emailConst, isDel } from '../const/entity-const';
import accountService from './account-service';
import r2Service from './r2-service';
import KvConst from '../const/kv-const';
import userService from './user-service';

function positiveInteger(value, fieldName, options = {}) {
	const number = Number(value);
	if (!Number.isInteger(number) || number <= 0) {
		if (options.optional && (value === undefined || value === null || value === '')) {
			return null;
		}
		throw new BizError(`${fieldName} must be a positive integer`, 400);
	}
	return number;
}

function limitValue(value, maximum) {
	if (value === undefined || value === null || value === '') {
		return Math.min(20, maximum);
	}
	const limit = Number(value);
	if (!Number.isInteger(limit) || limit <= 0 || limit > maximum) {
		throw new BizError(`limit must be an integer between 1 and ${maximum}`, 400);
	}
	return limit;
}

function dateTimeValue(value, fieldName) {
	if (value === undefined || value === null || value === '') return null;
	const text = String(value);
	if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) || !dayjs(text).isValid()) {
		throw new BizError(`${fieldName} must use YYYY-MM-DD HH:mm:ss`, 400);
	}
	return text;
}

function enumInteger(value, fieldName, allowed, optional = true) {
	if (optional && (value === undefined || value === null || value === '')) {
		return null;
	}
	const number = Number(value);
	if (!Number.isInteger(number) || !allowed.includes(number)) {
		throw new BizError(`${fieldName} must be one of: ${allowed.join(', ')}`, 400);
	}
	return number;
}

function parseJsonArray(value) {
	if (!value) {
		return [];
	}
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

async function ownedAccount(c, userId, accountId) {
	accountId = positiveInteger(accountId, 'accountId');
	const row = await orm(c)
		.select()
		.from(account)
		.where(
			and(
				eq(account.accountId, accountId),
				eq(account.userId, userId),
				eq(account.isDel, isDel.NORMAL)
			)
		)
		.get();

	if (!row) {
		throw new BizError('Account not found', 404);
	}
	return row;
}

async function ownedEmail(c, userId, emailId) {
	emailId = positiveInteger(emailId, 'emailId');
	const row = await orm(c)
		.select()
		.from(email)
		.where(
			and(
				eq(email.emailId, emailId),
				eq(email.userId, userId),
				eq(email.isDel, isDel.NORMAL)
			)
		)
		.get();

	if (!row) {
		throw new BizError('Email not found', 404);
	}
	return row;
}

function publicAccount(row) {
	return {
		accountId: row.accountId,
		email: row.email,
		name: row.name,
		status: row.status,
		latestEmailTime: row.latestEmailTime,
		createTime: row.createTime,
		allReceive: row.allReceive,
		sort: row.sort
	};
}

function emailSummary(row) {
	return {
		emailId: row.emailId,
		accountId: row.accountId,
		sendEmail: row.sendEmail,
		sendName: row.sendName,
		subject: row.subject,
		toEmail: row.toEmail,
		toName: row.toName,
		type: row.type,
		status: row.status,
		unread: row.unread,
		code: row.code,
		textPreview: row.textPreview,
		createTime: row.createTime
	};
}

function attachmentMetadata(row) {
	return {
		attachmentId: row.attId,
		emailId: row.emailId,
		accountId: row.accountId,
		filename: row.filename,
		mimeType: row.mimeType,
		size: row.size,
		disposition: row.disposition,
		contentId: row.contentId,
		type: row.type,
		createTime: row.createTime
	};
}

const restApiService = {
	async me(c, userId) {
		const userRow = await userService.selectById(c, userId);
		if (!userRow) {
			throw new BizError('User not found', 404);
		}

		const primaryAccount = await orm(c)
			.select({ name: account.name })
			.from(account)
			.where(
				and(
					eq(account.userId, userId),
					sql`${account.email} COLLATE NOCASE = ${userRow.email}`,
					eq(account.isDel, isDel.NORMAL)
				)
			)
			.get();

		const isAdmin = userRow.email === c.env.admin;
		return {
			userId: userRow.userId,
			email: userRow.email,
			name: primaryAccount?.name || userRow.email.split('@')[0],
			type: isAdmin ? 0 : userRow.type,
			role: isAdmin ? 'admin' : null
		};
	},

	async accountList(c, userId, query) {
		const limit = limitValue(query.limit, 50);
		const cursor = positiveInteger(query.cursor, 'cursor', { optional: true }) || 0;

		const rows = await orm(c)
			.select()
			.from(account)
			.where(
				and(
					eq(account.userId, userId),
					eq(account.isDel, isDel.NORMAL),
					gt(account.accountId, cursor)
				)
			)
			.orderBy(asc(account.accountId))
			.limit(limit + 1)
			.all();

		const hasMore = rows.length > limit;
		const items = rows.slice(0, limit).map(publicAccount);
		return {
			items,
			nextCursor: hasMore ? items.at(-1).accountId : null
		};
	},

	async accountCreate(c, userId, body) {
		let entries;
		if (Array.isArray(body)) entries = body;
		else if (Array.isArray(body?.emails)) entries = body.emails;
		else entries = [body];

		if (!entries.length || entries.length > 50) {
			throw new BizError('Provide between 1 and 50 email accounts', 400);
		}

		const items = [];
		for (const entry of entries) {
			const params = typeof entry === 'string' ? { email: entry } : entry;
			if (!params || typeof params.email !== 'string') {
				throw new BizError('Each account must be an email string or an object containing email', 400);
			}
			const row = await accountService.add(c, params, userId, {
				skipHumanVerification: true
			});
			items.push(publicAccount(row));
		}
		return { items };
	},

	async accountUpdate(c, userId, accountId, body) {
		const current = await ownedAccount(c, userId, accountId);
		const updates = {};

		if (Object.hasOwn(body || {}, 'name')) {
			const name = typeof body.name === 'string' ? body.name.trim() : '';
			if (!name) {
				throw new BizError('name must not be empty', 400);
			}
			if (name.length > 30) {
				throw new BizError('name must not exceed 30 characters', 400);
			}
			updates.name = name;
		}

		if (Object.hasOwn(body || {}, 'allReceive')) {
			const allReceive = enumInteger(
				body.allReceive,
				'allReceive',
				[accountConst.allReceive.CLOSE, accountConst.allReceive.OPEN],
				false
			);
			if (allReceive === accountConst.allReceive.OPEN) {
				await orm(c)
					.update(account)
					.set({ allReceive: accountConst.allReceive.CLOSE })
					.where(eq(account.userId, userId))
					.run();
			}
			updates.allReceive = allReceive;
		}

		if (Object.keys(updates).length === 0) {
			throw new BizError('At least one of name or allReceive is required', 400);
		}

		const row = await orm(c)
			.update(account)
			.set(updates)
			.where(
				and(
					eq(account.accountId, current.accountId),
					eq(account.userId, userId),
					eq(account.isDel, isDel.NORMAL)
				)
			)
			.returning()
			.get();

		return publicAccount(row);
	},

	async accountDelete(c, userId, accountId) {
		const [userRow, accountRow] = await Promise.all([
			userService.selectById(c, userId),
			ownedAccount(c, userId, accountId)
		]);

		if (accountRow.email.toLowerCase() === userRow.email.toLowerCase()) {
			throw new BizError('The primary account cannot be deleted', 409);
		}

		await orm(c)
			.update(account)
			.set({ isDel: isDel.DELETE, allReceive: accountConst.allReceive.CLOSE })
			.where(
				and(
					eq(account.accountId, accountRow.accountId),
					eq(account.userId, userId)
				)
			)
			.run();
	},

	async emailList(c, userId, query) {
		const limit = limitValue(query.limit, 50);
		const cursor =
			positiveInteger(query.cursor, 'cursor', { optional: true }) || 9999999999;
		const accountId = positiveInteger(query.accountId, 'accountId', {
			optional: true
		});
		const type = enumInteger(
			query.type,
			'type',
			[emailConst.type.RECEIVE, emailConst.type.SEND]
		);
		const unread = enumInteger(query.unread, 'unread', [0, 1]);
		const startTime = dateTimeValue(query.startTime, 'startTime');
		const endTime = dateTimeValue(query.endTime, 'endTime');
		if (startTime && endTime && startTime > endTime) {
			throw new BizError('startTime must not be after endTime', 400);
		}
		if (accountId && query.accountName) {
			throw new BizError('Use either accountId or accountName, not both', 400);
		}
		let selectedAccountIds = accountId ? [accountId] : [];

		if (accountId) {
			await ownedAccount(c, userId, accountId);
		} else if (query.accountName) {
			const accountRows = await orm(c).select({ accountId: account.accountId })
				.from(account).where(
					and(
						eq(account.userId, userId),
						eq(account.isDel, isDel.NORMAL),
						sql`(${account.name} COLLATE NOCASE = ${query.accountName} OR ${account.email} COLLATE NOCASE = ${query.accountName})`
					)
				).all();
			if (!accountRows.length) throw new BizError('Account not found', 404);
			selectedAccountIds = accountRows.map(row => row.accountId);
		}

		const conditions = [
			eq(email.userId, userId),
			eq(email.isDel, isDel.NORMAL),
			lt(email.emailId, cursor)
		];
		if (selectedAccountIds.length) {
			conditions.push(inArray(email.accountId, selectedAccountIds));
		}
		if (type !== null) {
			conditions.push(eq(email.type, type));
		}
		if (unread !== null) {
			conditions.push(eq(email.unread, unread));
		}
		if (startTime) conditions.push(gte(email.createTime, startTime));
		if (endTime) conditions.push(lte(email.createTime, endTime));

		const rows = await orm(c)
			.select({
				emailId: email.emailId,
				accountId: email.accountId,
				sendEmail: email.sendEmail,
				sendName: email.name,
				subject: email.subject,
				toEmail: email.toEmail,
				toName: email.toName,
				type: email.type,
				status: email.status,
				unread: email.unread,
				code: email.code,
				textPreview: sql`substr(coalesce(${email.text}, ''), 1, 240)`,
				createTime: email.createTime
			})
			.from(email)
			.where(and(...conditions))
			.orderBy(desc(email.emailId))
			.limit(limit + 1)
			.all();

		const hasMore = rows.length > limit;
		const items = rows.slice(0, limit).map(emailSummary);
		return {
			items,
			nextCursor: hasMore ? items.at(-1).emailId : null
		};
	},

	async emailDetail(c, userId, emailId) {
		const row = await ownedEmail(c, userId, emailId);
		const [{ total: attachmentCount }] = await Promise.all([
			orm(c)
				.select({ total: count() })
				.from(att)
				.where(and(eq(att.emailId, row.emailId), eq(att.userId, userId)))
				.get()
		]);

		return {
			emailId: row.emailId,
			accountId: row.accountId,
			sendEmail: row.sendEmail,
			sendName: row.name,
			subject: row.subject,
			text: row.text,
			content: row.content,
			recipient: parseJsonArray(row.recipient),
			cc: parseJsonArray(row.cc),
			bcc: parseJsonArray(row.bcc),
			toEmail: row.toEmail,
			toName: row.toName,
			messageId: row.messageId,
			inReplyTo: row.inReplyTo,
			type: row.type,
			status: row.status,
			unread: row.unread,
			code: row.code,
			createTime: row.createTime,
			attachmentCount
		};
	},

	async emailRead(c, userId, emailId) {
		const row = await ownedEmail(c, userId, emailId);
		await orm(c)
			.update(email)
			.set({ unread: emailConst.unread.READ })
			.where(and(eq(email.emailId, row.emailId), eq(email.userId, userId)))
			.run();
	},

	async emailDelete(c, userId, emailId) {
		const row = await ownedEmail(c, userId, emailId);
		await orm(c)
			.update(email)
			.set({ isDel: isDel.DELETE })
			.where(and(eq(email.emailId, row.emailId), eq(email.userId, userId)))
			.run();
	},

	async emailBatchDelete(c, userId, body) {
		const source = Array.isArray(body) ? body : body?.emailIds;
		const ids = [...new Set((source || []).map(Number))]
			.filter(id => Number.isInteger(id) && id > 0);
		if (!ids.length || ids.length > 100) {
			throw new BizError('emailIds must contain between 1 and 100 IDs', 400);
		}
		const ownedRows = await orm(c).select({ emailId: email.emailId }).from(email)
			.where(and(
				eq(email.userId, userId),
				eq(email.isDel, isDel.NORMAL),
				inArray(email.emailId, ids)
			)).all();
		const ownedIds = ownedRows.map(row => row.emailId);
		if (ownedIds.length) {
			await orm(c).update(email).set({ isDel: isDel.DELETE }).where(
				and(eq(email.userId, userId), inArray(email.emailId, ownedIds))
			).run();
		}
		return { deleted: ownedIds.length };
	},

	async attachmentList(c, userId, emailId) {
		const row = await ownedEmail(c, userId, emailId);
		const rows = await orm(c)
			.select()
			.from(att)
			.where(and(eq(att.emailId, row.emailId), eq(att.userId, userId)))
			.orderBy(asc(att.attId))
			.all();
		return rows.map(attachmentMetadata);
	},

	async adminUserList(c, query) {
		const limit = limitValue(query.limit, 100);
		const conditions = [];
		if (query.email) conditions.push(like(user.email, `%${query.email}%`));
		if (query.userId) {
			conditions.push(eq(user.userId, positiveInteger(query.userId, 'userId')));
		}
		const rows = await orm(c).select({
			userId: user.userId,
			email: user.email,
			type: user.type,
			status: user.status,
			accountLimit: user.accountLimit,
			createTime: user.createTime,
			isDel: user.isDel
		}).from(user).where(conditions.length ? and(...conditions) : undefined)
			.orderBy(desc(user.userId)).limit(limit).all();
		return { items: rows };
	},

	async adminUserCreate(c, body) {
		if (
			typeof body?.email !== 'string' ||
			typeof body?.password !== 'string' ||
			!Number.isInteger(Number(body?.type)) ||
			Number(body.type) <= 0
		) {
			throw new BizError('email, password, and a positive role type are required', 400);
		}
		await userService.add(c, {
			email: body.email,
			password: body.password,
			type: Number(body.type)
		});
		const row = await userService.selectByEmail(c, body.email);
		return { userId: row.userId, email: row.email };
	},

	async adminUserDelete(c, userId) {
		userId = positiveInteger(userId, 'userId');
		await userService.physicsDelete(c, { userIds: String(userId) });
	},

	async adminUserAccountLimit(c, userId, body) {
		userId = positiveInteger(userId, 'userId');
		const limit = Number(body.accountLimit);
		if (!Number.isInteger(limit) || limit < -1) {
			throw new BizError('accountLimit must be -1, 0, or a positive integer', 400);
		}
		if (!await userService.selectByIdIncludeDel(c, userId)) {
			throw new BizError('User not found', 404);
		}
		await orm(c).update(user).set({ accountLimit: limit })
			.where(eq(user.userId, userId)).run();
		return { userId, accountLimit: limit };
	},

	async adminEmailList(c, query) {
		const limit = limitValue(query.limit, 100);
		const conditions = [eq(email.isDel, isDel.NORMAL)];
		let selectedUserId = query.userId
			? positiveInteger(query.userId, 'userId')
			: null;
		if (query.userEmail) {
			const row = await userService.selectByEmailIncludeDel(c, query.userEmail);
			if (!row) throw new BizError('User not found', 404);
			if (selectedUserId && selectedUserId !== row.userId) {
				throw new BizError('userId and userEmail identify different users', 400);
			}
			selectedUserId = row.userId;
		}
		if (selectedUserId) conditions.push(eq(email.userId, selectedUserId));
		if (query.accountId) {
			conditions.push(eq(email.accountId, positiveInteger(query.accountId, 'accountId')));
		}
		const startTime = dateTimeValue(query.startTime, 'startTime');
		const endTime = dateTimeValue(query.endTime, 'endTime');
		if (startTime && endTime && startTime > endTime) {
			throw new BizError('startTime must not be after endTime', 400);
		}
		if (startTime) conditions.push(gte(email.createTime, startTime));
		if (endTime) conditions.push(lte(email.createTime, endTime));
		if (query.accountName) {
			const accountConditions = [
				eq(account.isDel, isDel.NORMAL),
				sql`(${account.name} COLLATE NOCASE = ${query.accountName} OR ${account.email} COLLATE NOCASE = ${query.accountName})`
			];
			if (selectedUserId) accountConditions.push(eq(account.userId, selectedUserId));
			const row = await orm(c).select().from(account)
				.where(and(...accountConditions)).get();
			if (!row) throw new BizError('Account not found', 404);
			conditions.push(eq(email.accountId, row.accountId));
		}
		const rows = await orm(c).select().from(email).where(and(...conditions))
			.orderBy(desc(email.emailId)).limit(limit).all();
		return { items: rows };
	},

	async adminSettings(c, body) {
		const fields = {
			restApiEnabled: 'rest_api_enabled',
			manyEmail: 'many_email',
			addEmail: 'add_email'
		};
		const allowed = {};
		for (const [key, column] of Object.entries(fields)) {
			if (body[key] === undefined) continue;
			const value = Number(body[key]);
			if (![0, 1].includes(value)) {
				throw new BizError(`${key} must be 0 or 1`, 400);
			}
			allowed[key] = value;
			await c.env.db.prepare(`UPDATE setting SET ${column} = ?`).bind(value).run();
		}
		if (!Object.keys(allowed).length) {
			throw new BizError('No supported settings supplied', 400);
		}

		const cached = await c.env.kv.get(KvConst.SETTING, { type: 'json' }) || {};
		Object.assign(cached, allowed);
		await c.env.kv.put(KvConst.SETTING, JSON.stringify(cached));
		c.set('setting', cached);
		return allowed;
	},

	async attachmentDownload(c, userId, emailId, attachmentId) {
		const emailRow = await ownedEmail(c, userId, emailId);
		attachmentId = positiveInteger(attachmentId, 'attachmentId');

		const row = await orm(c)
			.select()
			.from(att)
			.where(
				and(
					eq(att.attId, attachmentId),
					eq(att.emailId, emailRow.emailId),
					eq(att.userId, userId)
				)
			)
			.get();

		if (!row) {
			throw new BizError('Attachment not found', 404);
		}

		const object = await r2Service.getObj(c, row.key);
		if (!object) {
			throw new BizError('Attachment content not found', 404);
		}

		if (object instanceof Response) {
			const headers = new Headers(object.headers);
			headers.set('Cache-Control', 'private, no-store');
			headers.set(
				'Content-Type',
				row.mimeType || headers.get('Content-Type') || 'application/octet-stream'
			);
			headers.set(
				'Content-Disposition',
				`attachment; filename*=UTF-8''${encodeURIComponent(row.filename || 'attachment')}`
			);
			return new Response(object.body, {
				status: object.status,
				headers
			});
		}

		return new Response(object.body, {
			headers: {
				'Cache-Control': 'private, no-store',
				'Content-Type':
					row.mimeType ||
					object.httpMetadata?.contentType ||
					'application/octet-stream',
				'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(
					row.filename || 'attachment'
				)}`
			}
		});
	}
};

export { ownedAccount, ownedEmail };
export default restApiService;