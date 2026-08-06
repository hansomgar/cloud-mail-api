import { and, count, desc, eq, like, sql } from 'drizzle-orm';
import dayjs from 'dayjs';
import apiKey from '../entity/api-key';
import user from '../entity/user';
import orm from '../entity/orm';
import BizError from '../error/biz-error';
import userService from './user-service';
import { isDel, userConst } from '../const/entity-const';

const API_KEY_PREFIX = 'cma';
const API_KEY_ACTIVE = 0;
const API_KEY_REVOKED = 1;
const MAX_ACTIVE_KEYS = 10;
const encoder = new TextEncoder();

function toBase64Url(bytes) {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function randomBytes(length) {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return bytes;
}

function randomHex(length) {
	return [...randomBytes(length)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left, right) {
	const a = encoder.encode(left || '');
	const b = encoder.encode(right || '');
	const length = Math.max(a.length, b.length);
	let diff = a.length ^ b.length;
	for (let index = 0; index < length; index += 1) {
		diff |= (a[index] || 0) ^ (b[index] || 0);
	}
	return diff === 0;
}

function requestIp(c) {
	return (
		c.req.header('CF-Connecting-IP') ||
		c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
		c.req.header('X-Real-IP') ||
		''
	);
}

function isValidIp(value) {
	const ipv4 = value.split('.');
	if (
		ipv4.length === 4 &&
		ipv4.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
	) {
		return true;
	}
	if (!value.includes(':')) return false;
	try {
		return new URL(`http://[${value}]/`).hostname.length > 0;
	} catch {
		return false;
	}
}

function normalizeWhitelist(value) {
	if (Array.isArray(value)) value = value.join(',');
	const items = String(value || '')
		.split(/[\s,，]+/)
		.map(item => item.trim())
		.filter(Boolean)
		.filter((item, index, list) => list.indexOf(item) === index);
	const invalid = items.find(item => !isValidIp(item));
	if (invalid) throw new BizError(`Invalid IP address: ${invalid}`, 400);
	return items.join(',');
}

function parseExpireTime(params) {
	if (params?.permanent === true) return null;
	if (params?.permanent === false && !params?.expireTime) {
		throw new BizError('expireTime is required when permanent is false', 400);
	}
	if (!params?.expireTime) return null;
	const value = dayjs(params.expireTime);
	if (!value.isValid() || !value.isAfter(dayjs())) {
		throw new BizError('expireTime must be a valid future date', 400);
	}
	return value.format('YYYY-MM-DD HH:mm:ss');
}

function publicRow(row) {
	return {
		apiKeyId: row.apiKeyId,
		userId: row.userId,
		userEmail: row.userEmail,
		name: row.name,
		apiKey: row.apiKey,
		keyPrefix: row.keyPrefix,
		ipWhitelist: row.ipWhitelist ? row.ipWhitelist.split(',').filter(Boolean) : [],
		expireTime: row.expireTime,
		permanent: !row.expireTime,
		isAdmin: row.isAdmin,
		status: row.status,
		createTime: row.createTime,
		lastUsedTime: row.lastUsedTime,
		lastUsedIp: row.lastUsedIp,
		lastRequest: row.lastRequest,
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

async function owner(c, userId) {
	const row = await userService.selectByIdIncludeDel(c, userId);
	if (!row || row.isDel !== isDel.NORMAL || row.status !== userConst.status.NORMAL) {
		throw new BizError('API key owner is disabled or does not exist', 403);
	}
	return row;
}

function ensureWebAdmin(c) {
	const current = c.get('user');
	if (!current || current.email !== c.env.admin) {
		throw new BizError('Only the administrator can perform this operation', 403);
	}
}

function redact(value) {
	if (Array.isArray(value)) return value.map(redact);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [
		key,
		/(password|token|secret|api.?key)/i.test(key) ? '[REDACTED]' : redact(item)
	]));
}

async function auditRequest(c, row) {
	let body = '';
	try {
		const text = await c.req.raw.clone().text();
		if (text) {
			try {
				body = JSON.stringify(redact(JSON.parse(text))).slice(0, 2000);
			} catch {
				body = `[UNPARSED BODY: ${text.length} bytes]`;
			}
		}
	} catch {
		body = '';
	}
	const detail = JSON.stringify({
		method: c.req.method,
		path: c.req.path,
		query: redact(c.req.query()),
		body
	});
	await orm(c)
		.update(apiKey)
		.set({
			lastUsedTime: dayjs().format('YYYY-MM-DD HH:mm:ss'),
			lastUsedIp: requestIp(c),
			lastRequest: detail
		})
		.where(eq(apiKey.apiKeyId, row.apiKeyId))
		.run();
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

	async adminList(c, params = {}) {
		ensureWebAdmin(c);
		const conditions = [];
		if (params.userId) conditions.push(eq(apiKey.userId, Number(params.userId)));
		if (params.name) conditions.push(like(apiKey.name, `%${params.name}%`));
		if (params.email) conditions.push(like(user.email, `%${params.email}%`));
		if (params.status !== undefined && params.status !== '') {
			conditions.push(eq(apiKey.status, Number(params.status)));
		}
		const rows = await orm(c)
			.select({ ...apiKey, userEmail: user.email })
			.from(apiKey)
			.leftJoin(user, eq(user.userId, apiKey.userId))
			.where(conditions.length ? and(...conditions) : undefined)
			.orderBy(desc(apiKey.apiKeyId))
			.limit(500)
			.all();
		const settings = await c.env.db.prepare(
			`SELECT rest_api_enabled, many_email, add_email FROM setting LIMIT 1`
		).first();
		return {
			enabled: settings?.rest_api_enabled === 0,
			settings: {
				restApiEnabled: settings?.rest_api_enabled ?? 1,
				manyEmail: settings?.many_email ?? 1,
				addEmail: settings?.add_email ?? 1
			},
			list: rows.map(publicRow)
		};
	},

	async create(c, userId, params = {}, options = {}) {
		const isAdmin = options.isAdmin === true;
		if (isAdmin || options.bypassEnabled === true) ensureWebAdmin(c);
		else await ensureRestApiEnabled(c);

		const userRow = await owner(c, userId);
		if (isAdmin && userRow.email !== c.env.admin) {
			throw new BizError('Administrator API keys must belong to the administrator', 403);
		}

		const name = typeof params.name === 'string' ? params.name.trim() : '';
		if (!name || name.length > 50) {
			throw new BizError('API key name is required and must not exceed 50 characters', 400);
		}

		const [{ total }, existing] = await Promise.all([
			orm(c).select({ total: count() }).from(apiKey).where(
				and(eq(apiKey.userId, userId), eq(apiKey.status, API_KEY_ACTIVE))
			).get(),
			orm(c).select({ apiKeyId: apiKey.apiKeyId }).from(apiKey).where(
				and(
					eq(apiKey.userId, userId),
					eq(apiKey.status, API_KEY_ACTIVE),
					sql`${apiKey.name} COLLATE NOCASE = ${name}`
				)
			).get()
		]);
		if (total >= MAX_ACTIVE_KEYS) {
			throw new BizError(`A user can have at most ${MAX_ACTIVE_KEYS} active API keys`, 409);
		}
		if (existing) throw new BizError('An active API key with this name already exists', 409);

		const publicId = randomHex(12);
		const token = `${API_KEY_PREFIX}_${publicId}_${toBase64Url(randomBytes(32))}`;
		const row = await orm(c).insert(apiKey).values({
			publicId,
			userId,
			name,
			keyPrefix: `${API_KEY_PREFIX}_${publicId}_${token.slice(-43, -39)}…`,
			apiKey: token,
			ipWhitelist: normalizeWhitelist(params.ipWhitelist),
			expireTime: parseExpireTime(params),
			isAdmin: isAdmin ? 1 : 0,
			status: API_KEY_ACTIVE
		}).returning().get();
		return publicRow(row);
	},

	async update(c, actorUserId, apiKeyId, params = {}) {
		apiKeyId = Number(apiKeyId);
		const row = await orm(c).select().from(apiKey).where(eq(apiKey.apiKeyId, apiKeyId)).get();
		if (!row) throw new BizError('API key not found', 404);
		const current = c.get('user');
		const admin = current?.email === c.env.admin;
		if (row.userId !== actorUserId && !admin) throw new BizError('API key not found', 404);
		const values = {};
		if (params.name !== undefined) {
			const name = String(params.name).trim();
			if (!name || name.length > 50) throw new BizError('Invalid API key name', 400);
			values.name = name;
		}
		if (params.ipWhitelist !== undefined) {
			values.ipWhitelist = normalizeWhitelist(params.ipWhitelist);
		}
		if (params.expireTime !== undefined || params.permanent !== undefined) {
			values.expireTime = parseExpireTime(params);
		}
		if (!Object.keys(values).length) throw new BizError('No update fields supplied', 400);
		await orm(c).update(apiKey).set(values).where(eq(apiKey.apiKeyId, apiKeyId)).run();
		return publicRow({ ...row, ...values });
	},

	async revoke(c, actorUserId, apiKeyId) {
		apiKeyId = Number(apiKeyId);
		const row = await orm(c).select().from(apiKey).where(eq(apiKey.apiKeyId, apiKeyId)).get();
		if (!row) throw new BizError('API key not found', 404);
		const admin = c.get('user')?.email === c.env.admin;
		if (row.userId !== actorUserId && !admin) throw new BizError('API key not found', 404);
		await orm(c).update(apiKey).set({
			status: API_KEY_REVOKED,
			revokeTime: dayjs().format('YYYY-MM-DD HH:mm:ss')
		}).where(eq(apiKey.apiKeyId, apiKeyId)).run();
	},

	async authenticate(c) {
		const authorization = c.req.header('Authorization') || '';
		const match = authorization.match(/^Bearer\s+cma_([a-f0-9]{24})_([A-Za-z0-9_-]{43})$/);
		if (!match) throw new BizError('Missing or invalid Bearer API key', 401);
		const row = await orm(c).select().from(apiKey).where(
			and(eq(apiKey.publicId, match[1]), eq(apiKey.status, API_KEY_ACTIVE))
		).get();
		if (!row || !constantTimeEqual(row.apiKey, authorization.slice(7))) {
			throw new BizError('Invalid or revoked API key', 401);
		}
		if (row.expireTime && !dayjs(row.expireTime).isAfter(dayjs())) {
			throw new BizError('API key has expired', 401);
		}
		const userRow = await owner(c, row.userId);
		if (!row.isAdmin) await ensureRestApiEnabled(c);
		if (row.isAdmin && userRow.email !== c.env.admin) {
			throw new BizError('Invalid administrator API key', 403);
		}
		const whitelist = row.ipWhitelist.split(',').filter(Boolean);
		const ip = requestIp(c);
		if (whitelist.length && !whitelist.includes(ip)) {
			throw new BizError('Request IP is not allowed by this API key', 403);
		}
		await auditRequest(c, row);
		return {
			apiKeyId: row.apiKeyId,
			userId: row.userId,
			user: userRow,
			isAdmin: row.isAdmin === 1
		};
	},

	ensureWebAdmin(c) {
		ensureWebAdmin(c);
	},

	ensureAdminApi(c) {
		if (!c.get('apiAuth')?.isAdmin) {
			throw new BizError('Administrator API key required', 403);
		}
	},

	isRestApiEnabled,
	ensureRestApiEnabled
};

export default apiKeyService;