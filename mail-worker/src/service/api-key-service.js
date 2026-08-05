import { and, count, desc, eq, sql } from 'drizzle-orm';
import dayjs from 'dayjs';
import apiKey from '../entity/api-key';
import orm from '../entity/orm';
import BizError from '../error/biz-error';
import userService from './user-service';
import { isDel, userConst } from '../const/entity-const';

const API_KEY_PREFIX = 'cma';
const API_KEY_ACTIVE = 0;
const API_KEY_REVOKED = 1;
const MAX_ACTIVE_KEYS = 10;
const LAST_USED_UPDATE_MINUTES = 5;
const encoder = new TextEncoder();

function toBase64Url(bytes) {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replaceAll('=', '');
}

function randomBytes(byteLength) {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return bytes;
}

function randomString(byteLength) {
	return toBase64Url(randomBytes(byteLength));
}

function randomHex(byteLength) {
	return [...randomBytes(byteLength)]
		.map(byte => byte.toString(16).padStart(2, '0'))
		.join('');
}

async function sha256(value) {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
	return toBase64Url(new Uint8Array(digest));
}

function constantTimeEqual(left, right) {
	const leftBytes = encoder.encode(left);
	const rightBytes = encoder.encode(right);
	const length = Math.max(leftBytes.length, rightBytes.length);
	let difference = leftBytes.length ^ rightBytes.length;

	for (let index = 0; index < length; index += 1) {
		difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
	}

	return difference === 0;
}

function publicRow(row) {
	return {
		apiKeyId: row.apiKeyId,
		name: row.name,
		keyPrefix: row.keyPrefix,
		status: row.status,
		createTime: row.createTime,
		lastUsedTime: row.lastUsedTime,
		revokeTime: row.revokeTime
	};
}

async function isRestApiEnabled(c) {
	const row = await c.env.db
		.prepare(`SELECT rest_api_enabled AS enabled FROM setting LIMIT 1`)
		.first();
	return row?.enabled === 0;
}

async function ensureRestApiEnabled(c) {
	if (!await isRestApiEnabled(c)) {
		throw new BizError('REST API is disabled by the administrator', 403);
	}
}

const apiKeyService = {
	async status(c, userId) {
		const [enabled, rows] = await Promise.all([
			isRestApiEnabled(c),
			orm(c)
			.select()
			.from(apiKey)
			.where(eq(apiKey.userId, userId))
			.orderBy(desc(apiKey.apiKeyId))
			.all()
		]);

		return {
			enabled,
			maxActiveKeys: MAX_ACTIVE_KEYS,
			list: rows.map(publicRow)
		};
	},

	async create(c, userId, params) {
		await ensureRestApiEnabled(c);

		const name = typeof params?.name === 'string' ? params.name.trim() : '';
		if (!name) {
			throw new BizError('API key name is required', 400);
		}
		if (name.length > 50) {
			throw new BizError('API key name must not exceed 50 characters', 400);
		}

		const userRow = await userService.selectById(c, userId);
		if (!userRow || userRow.status !== userConst.status.NORMAL) {
			throw new BizError('User is disabled or does not exist', 403);
		}

		const [{ total }, existing] = await Promise.all([
			orm(c)
				.select({ total: count() })
				.from(apiKey)
				.where(and(eq(apiKey.userId, userId), eq(apiKey.status, API_KEY_ACTIVE)))
				.get(),
			orm(c)
				.select({ apiKeyId: apiKey.apiKeyId })
				.from(apiKey)
				.where(
					and(
						eq(apiKey.userId, userId),
						eq(apiKey.status, API_KEY_ACTIVE),
						sql`${apiKey.name} COLLATE NOCASE = ${name}`
					)
				)
				.get()
		]);

		if (total >= MAX_ACTIVE_KEYS) {
			throw new BizError(`A user can have at most ${MAX_ACTIVE_KEYS} active API keys`, 409);
		}
		if (existing) {
			throw new BizError('An active API key with this name already exists', 409);
		}

		const publicId = randomHex(12);
		const secret = randomString(32);
		const token = `${API_KEY_PREFIX}_${publicId}_${secret}`;
		const keyHash = await sha256(token);
		const keyPrefix = `${API_KEY_PREFIX}_${publicId}_${secret.slice(0, 4)}…`;

		let row;
		try {
			row = await orm(c)
				.insert(apiKey)
				.values({
					publicId,
					userId,
					name,
					keyHash,
					keyPrefix,
					status: API_KEY_ACTIVE
				})
				.returning()
				.get();
		} catch (error) {
			if (error.message?.includes('SQLITE_CONSTRAINT')) {
				throw new BizError('API key name or identifier already exists', 409);
			}
			throw error;
		}

		return {
			...publicRow(row),
			key: token
		};
	},

	async revoke(c, userId, apiKeyId) {
		apiKeyId = Number(apiKeyId);
		if (!Number.isInteger(apiKeyId) || apiKeyId <= 0) {
			throw new BizError('Invalid API key ID', 400);
		}

		const row = await orm(c)
			.select({ apiKeyId: apiKey.apiKeyId, status: apiKey.status })
			.from(apiKey)
			.where(and(eq(apiKey.apiKeyId, apiKeyId), eq(apiKey.userId, userId)))
			.get();

		if (!row) {
			throw new BizError('API key not found', 404);
		}
		if (row.status === API_KEY_REVOKED) {
			return;
		}

		await orm(c)
			.update(apiKey)
			.set({
				status: API_KEY_REVOKED,
				revokeTime: dayjs().format('YYYY-MM-DD HH:mm:ss')
			})
			.where(and(eq(apiKey.apiKeyId, apiKeyId), eq(apiKey.userId, userId)))
			.run();
	},

	async revokeByUserIds(c, userIds) {
		if (!Array.isArray(userIds) || userIds.length === 0) {
			return;
		}

		const placeholders = userIds.map(() => '?').join(',');
		await c.env.db
			.prepare(`DELETE FROM api_key WHERE user_id IN (${placeholders})`)
			.bind(...userIds)
			.run();
	},

	async authenticate(c) {
		await ensureRestApiEnabled(c);

		const authorization = c.req.header('Authorization') || '';
		const match = authorization.match(
			/^Bearer\s+cma_([a-f0-9]{24})_([A-Za-z0-9_-]{43})$/
		);
		if (!match) {
			throw new BizError('Missing or invalid Bearer API key', 401);
		}

		const [, publicId] = match;
		const row = await orm(c)
			.select()
			.from(apiKey)
			.where(and(eq(apiKey.publicId, publicId), eq(apiKey.status, API_KEY_ACTIVE)))
			.get();

		if (!row) {
			throw new BizError('Invalid or revoked API key', 401);
		}

		const requestHash = await sha256(authorization.slice('Bearer '.length));
		if (!constantTimeEqual(requestHash, row.keyHash)) {
			throw new BizError('Invalid or revoked API key', 401);
		}

		const userRow = await userService.selectByIdIncludeDel(c, row.userId);
		if (
			!userRow ||
			userRow.isDel !== isDel.NORMAL ||
			userRow.status !== userConst.status.NORMAL
		) {
			throw new BizError('API key owner is disabled or does not exist', 403);
		}

		const lastUsed = row.lastUsedTime ? dayjs(row.lastUsedTime) : null;
		if (!lastUsed || dayjs().diff(lastUsed, 'minute') >= LAST_USED_UPDATE_MINUTES) {
			await orm(c)
				.update(apiKey)
				.set({ lastUsedTime: dayjs().format('YYYY-MM-DD HH:mm:ss') })
				.where(eq(apiKey.apiKeyId, row.apiKeyId))
				.run();
		}

		return {
			apiKeyId: row.apiKeyId,
			userId: row.userId,
			user: userRow
		};
	}
};

export {
	API_KEY_ACTIVE,
	API_KEY_REVOKED,
	MAX_ACTIVE_KEYS,
	ensureRestApiEnabled,
	isRestApiEnabled
};
export default apiKeyService;