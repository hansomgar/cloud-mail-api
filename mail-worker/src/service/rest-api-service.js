import { and, asc, count, desc, eq, gt, lt, sql } from 'drizzle-orm';
import account from '../entity/account';
import { att } from '../entity/att';
import email from '../entity/email';
import orm from '../entity/orm';
import BizError from '../error/biz-error';
import { accountConst, emailConst, isDel } from '../const/entity-const';
import accountService from './account-service';
import r2Service from './r2-service';
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
		const row = await accountService.add(c, body, userId, {
			skipHumanVerification: true
		});
		return publicAccount(row);
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

		if (accountId) {
			await ownedAccount(c, userId, accountId);
		}

		const conditions = [
			eq(email.userId, userId),
			eq(email.isDel, isDel.NORMAL),
			lt(email.emailId, cursor)
		];
		if (accountId) {
			conditions.push(eq(email.accountId, accountId));
		}
		if (type !== null) {
			conditions.push(eq(email.type, type));
		}
		if (unread !== null) {
			conditions.push(eq(email.unread, unread));
		}

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