import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/index.js';
import apiKeyService from '../src/service/api-key-service.js';
import {
	createExecutionContext,
	createLocalCloudflareEnvironment
} from './local-cloudflare.js';

let env;

const USER_ONE_PUBLIC_ID = '111111111111111111111111';
const USER_TWO_PUBLIC_ID = '222222222222222222222222';
const USER_ONE_KEY = `cma_${USER_ONE_PUBLIC_ID}_${'A'.repeat(43)}`;
const USER_TWO_KEY = `cma_${USER_TWO_PUBLIC_ID}_${'B'.repeat(43)}`;

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

async function hashKey(value) {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(value)
	);
	return toBase64Url(new Uint8Array(digest));
}

async function resetDatabase() {
	await env.db.exec(`
		DROP TABLE IF EXISTS api_key;
		DROP TABLE IF EXISTS attachments;
		DROP TABLE IF EXISTS email;
		DROP TABLE IF EXISTS account;
		DROP TABLE IF EXISTS role;
		DROP TABLE IF EXISTS setting;
		DROP TABLE IF EXISTS user;

		CREATE TABLE setting (
			rest_api_enabled INTEGER NOT NULL DEFAULT 1
		);

		CREATE TABLE user (
			user_id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL,
			type INTEGER NOT NULL DEFAULT 1,
			password TEXT NOT NULL,
			salt TEXT NOT NULL,
			status INTEGER NOT NULL DEFAULT 0,
			create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
			active_time DATETIME,
			create_ip TEXT,
			active_ip TEXT,
			os TEXT,
			browser TEXT,
			device TEXT,
			sort INTEGER DEFAULT 0,
			send_count INTEGER DEFAULT 0,
			reg_key_id INTEGER NOT NULL DEFAULT 0,
			is_del INTEGER NOT NULL DEFAULT 0
		);

		CREATE TABLE role (
			role_id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			key TEXT NOT NULL,
			description TEXT,
			ban_email TEXT NOT NULL DEFAULT '',
			ban_email_type INTEGER NOT NULL DEFAULT 0,
			avail_domain TEXT DEFAULT '',
			sort INTEGER,
			is_default INTEGER DEFAULT 0,
			create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			user_id INTEGER,
			send_count INTEGER,
			send_type TEXT DEFAULT 'count',
			account_count INTEGER
		);

		CREATE TABLE account (
			account_id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL,
			name TEXT NOT NULL DEFAULT '',
			status INTEGER NOT NULL DEFAULT 0,
			latest_email_time DATETIME,
			create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
			user_id INTEGER NOT NULL,
			all_receive INTEGER NOT NULL DEFAULT 0,
			sort INTEGER NOT NULL DEFAULT 0,
			is_del INTEGER NOT NULL DEFAULT 0
		);

		CREATE TABLE email (
			email_id INTEGER PRIMARY KEY AUTOINCREMENT,
			send_email TEXT,
			name TEXT,
			account_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			subject TEXT,
			code TEXT NOT NULL DEFAULT '',
			text TEXT,
			content TEXT,
			cc TEXT DEFAULT '[]',
			bcc TEXT DEFAULT '[]',
			recipient TEXT DEFAULT '[]',
			to_email TEXT NOT NULL DEFAULT '',
			to_name TEXT NOT NULL DEFAULT '',
			in_reply_to TEXT DEFAULT '',
			relation TEXT DEFAULT '',
			message_id TEXT DEFAULT '',
			type INTEGER NOT NULL DEFAULT 0,
			status INTEGER NOT NULL DEFAULT 0,
			resend_email_id TEXT,
			message TEXT,
			unread INTEGER NOT NULL DEFAULT 0,
			create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			is_del INTEGER NOT NULL DEFAULT 0
		);

		CREATE TABLE attachments (
			att_id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			email_id INTEGER NOT NULL,
			account_id INTEGER NOT NULL,
			key TEXT NOT NULL,
			filename TEXT,
			mime_type TEXT,
			size INTEGER,
			status INTEGER NOT NULL DEFAULT 0,
			type INTEGER NOT NULL DEFAULT 0,
			disposition TEXT,
			related TEXT,
			content_id TEXT,
			encoding TEXT,
			create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE api_key (
			api_key_id INTEGER PRIMARY KEY AUTOINCREMENT,
			public_id TEXT NOT NULL,
			user_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			key_hash TEXT NOT NULL,
			key_prefix TEXT NOT NULL,
			status INTEGER NOT NULL DEFAULT 0,
			create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_used_time DATETIME,
			revoke_time DATETIME
		);
	`);

	await env.db.batch([
		env.db.prepare(`INSERT INTO setting (rest_api_enabled) VALUES (0)`),
		env.db
			.prepare(
				`INSERT INTO role
				 (role_id, name, key, ban_email, ban_email_type, avail_domain,
				  send_type, account_count)
				 VALUES (1, 'Regular', 'regular', '', 0, 'example.test', 'count', 10)`
			),
		env.db
			.prepare(
				`INSERT INTO user (user_id, email, password, salt, status, is_del)
				 VALUES (?, ?, 'hash', 'salt', 0, 0)`
			)
			.bind(1, 'one@example.test'),
		env.db
			.prepare(
				`INSERT INTO user (user_id, email, password, salt, status, is_del)
				 VALUES (?, ?, 'hash', 'salt', 0, 0)`
			)
			.bind(2, 'two@example.test'),
		env.db
			.prepare(
				`INSERT INTO account
				 (account_id, email, name, user_id, all_receive, is_del)
				 VALUES (?, ?, ?, ?, 0, 0)`
			)
			.bind(1, 'one@example.test', 'One', 1),
		env.db
			.prepare(
				`INSERT INTO account
				 (account_id, email, name, user_id, all_receive, is_del)
				 VALUES (?, ?, ?, ?, 0, 0)`
			)
			.bind(2, 'child@example.test', 'Child', 1),
		env.db
			.prepare(
				`INSERT INTO account
				 (account_id, email, name, user_id, all_receive, is_del)
				 VALUES (?, ?, ?, ?, 0, 0)`
			)
			.bind(3, 'two@example.test', 'Two', 2),
		env.db
			.prepare(
				`INSERT INTO email
				 (email_id, send_email, name, account_id, user_id, subject, text, content,
				  recipient, to_email, to_name, type, unread, is_del)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 0, 0, 0)`
			)
			.bind(
				1,
				'sender@example.org',
				'Sender',
				1,
				1,
				'Owned message',
				'Owned text',
				'<p>Owned HTML</p>',
				'one@example.test',
				'One'
			),
		env.db
			.prepare(
				`INSERT INTO email
				 (email_id, send_email, name, account_id, user_id, subject, text, content,
				  recipient, to_email, to_name, type, unread, is_del)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 0, 0, 0)`
			)
			.bind(
				2,
				'private@example.org',
				'Private',
				3,
				2,
				'Other user message',
				'Secret text',
				'<p>Secret HTML</p>',
				'two@example.test',
				'Two'
			),
		env.db
			.prepare(
				`INSERT INTO attachments
				 (att_id, user_id, email_id, account_id, key, filename, mime_type, size)
				 VALUES (1, 1, 1, 1, 'attachments/owned.txt', 'owned.txt', 'text/plain', 16)`
			),
		env.db
			.prepare(
				`INSERT INTO attachments
				 (att_id, user_id, email_id, account_id, key, filename, mime_type, size)
				 VALUES (2, 2, 2, 3, 'attachments/private.txt', 'private.txt', 'text/plain', 18)`
			),
		env.db
			.prepare(
				`INSERT INTO api_key
				 (api_key_id, public_id, user_id, name, key_hash, key_prefix, status)
				 VALUES (?, ?, ?, ?, ?, ?, 0)`
			)
			.bind(
				1,
				USER_ONE_PUBLIC_ID,
				1,
				'User one test',
				await hashKey(USER_ONE_KEY),
				`cma_${USER_ONE_PUBLIC_ID}_AAAA…`
			),
		env.db
			.prepare(
				`INSERT INTO api_key
				 (api_key_id, public_id, user_id, name, key_hash, key_prefix, status)
				 VALUES (?, ?, ?, ?, ?, ?, 0)`
			)
			.bind(
				2,
				USER_TWO_PUBLIC_ID,
				2,
				'User two test',
				await hashKey(USER_TWO_KEY),
				`cma_${USER_TWO_PUBLIC_ID}_BBBB…`
			)
	]);

	await env.kv.put(
		'attachments/owned.txt',
		new TextEncoder().encode('owned attachment'),
		{
			metadata: {
				contentType: 'text/plain',
				contentDisposition: 'attachment; filename="owned.txt"'
			}
		}
	);
	await env.kv.put(
		'attachments/private.txt',
		new TextEncoder().encode('private attachment'),
		{
			metadata: {
				contentType: 'text/plain',
				contentDisposition: 'attachment; filename="private.txt"'
			}
		}
	);
}

async function setApiEnabled(enabled) {
	await env.db
		.prepare(`UPDATE setting SET rest_api_enabled = ?`)
		.bind(enabled ? 0 : 1)
		.run();

	await env.kv.put(
		'setting:',
		JSON.stringify({
			restApiEnabled: enabled ? 0 : 1,
			emailPrefixFilter: '',
			resendTokens: {},
			addEmail: 0,
			manyEmail: 0,
			addEmailVerify: 0,
			addVerifyCount: 1,
			minEmailPrefix: 1
		})
	);
}

async function apiRequest(path, key = USER_ONE_KEY, init = {}) {
	const headers = new Headers(init.headers || {});
	if (key) {
		headers.set('Authorization', `Bearer ${key}`);
	}

	const context = createExecutionContext();
	const request = new Request(`https://example.test/api/v1${path}`, {
		...init,
		headers
	});
	const response = await worker.fetch(request, env, context);
	await Promise.all(context.promises);
	return response;
}

beforeEach(async () => {
	env?.db.close();
	env = createLocalCloudflareEnvironment();
	await resetDatabase();
	await setApiEnabled(true);
});

afterAll(() => {
	env?.db.close();
});

function serviceContext() {
	const values = new Map();
	return {
		env,
		get(key) {
			return values.get(key);
		},
		set(key, value) {
			values.set(key, value);
		}
	};
}

describe('Cloud Mail API key management', () => {
	it('creates multiple named keys, stores only hashes, and revokes keys independently', async () => {
		const context = serviceContext();
		const first = await apiKeyService.create(context, 1, {
			name: 'Home server'
		});
		const second = await apiKeyService.create(context, 1, {
			name: 'Mobile automation'
		});

		expect(first.key).toMatch(/^cma_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/);
		expect(second.key).not.toBe(first.key);

		const stored = await env.db
			.prepare(
				`SELECT name, key_hash, key_prefix, status
				 FROM api_key
				 WHERE user_id = 1 AND name IN (?, ?)
				 ORDER BY api_key_id`
			)
			.bind('Home server', 'Mobile automation')
			.all();

		expect(stored.results).toHaveLength(2);
		expect(stored.results[0].key_hash).not.toBe(first.key);
		expect(stored.results[0].key_prefix).not.toBe(first.key);

		const status = await apiKeyService.status(serviceContext(), 1);
		const firstPublic = status.list.find(item => item.apiKeyId === first.apiKeyId);
		expect(firstPublic.key).toBeUndefined();

		await apiKeyService.revoke(serviceContext(), 1, first.apiKeyId);

		const revokedResponse = await apiRequest('/accounts', first.key);
		const activeResponse = await apiRequest('/accounts', second.key);
		expect(revokedResponse.status).toBe(401);
		expect(activeResponse.status).toBe(200);
	});
});

describe('Cloud Mail REST API authentication', () => {
	it('returns 403 when the administrator disables REST API access', async () => {
		await setApiEnabled(false);
		const response = await apiRequest('/accounts');

		expect(response.status).toBe(403);
		expect((await response.json()).error.code).toBe('FORBIDDEN');
	});

	it('returns 401 for a missing or forged API key', async () => {
		const missing = await apiRequest('/accounts', null);
		expect(missing.status).toBe(401);

		const forged = await apiRequest(
			'/accounts',
			`cma_${USER_ONE_PUBLIC_ID}_${'C'.repeat(43)}`
		);
		expect(forged.status).toBe(401);
	});

	it('returns 401 immediately after a key is revoked', async () => {
		await env.db
			.prepare(`UPDATE api_key SET status = 1 WHERE api_key_id = 1`)
			.run();

		const response = await apiRequest('/accounts');
		expect(response.status).toBe(401);
	});

	it('returns 403 when the API key owner is banned', async () => {
		await env.db.prepare(`UPDATE user SET status = 1 WHERE user_id = 1`).run();

		const response = await apiRequest('/accounts');
		expect(response.status).toBe(403);
	});
});

describe('Cloud Mail REST API ownership isolation', () => {
	it('returns only the API key owner from the current-user endpoint', async () => {
		const response = await apiRequest('/me');
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.data.userId).toBe(1);
		expect(body.data.email).toBe('one@example.test');
		expect(body.data.name).toBe('One');
	});

	it('lists only accounts owned by the API key user', async () => {
		const response = await apiRequest('/accounts');
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.data.items.map(item => item.accountId)).toEqual([1, 2]);
		expect(body.data.items.some(item => item.accountId === 3)).toBe(false);
	});

	it('does not reveal an email owned by another user', async () => {
		const response = await apiRequest('/emails/2');
		expect(response.status).toBe(404);
		expect((await response.json()).error.code).toBe('NOT_FOUND');
	});

	it('returns an owned email body only from the detail endpoint', async () => {
		const listResponse = await apiRequest('/emails');
		const listBody = await listResponse.json();

		expect(listResponse.status).toBe(200);
		expect(listBody.data.items).toHaveLength(1);
		expect(listBody.data.items[0].content).toBeUndefined();
		expect(listBody.data.items[0].textPreview).toBe('Owned text');

		const detailResponse = await apiRequest('/emails/1');
		const detailBody = await detailResponse.json();

		expect(detailResponse.status).toBe(200);
		expect(detailBody.data.content).toBe('<p>Owned HTML</p>');
		expect(detailBody.data.text).toBe('Owned text');
	});

	it('lists and downloads only attachments owned by the API key user', async () => {
		const listResponse = await apiRequest('/emails/1/attachments');
		const listBody = await listResponse.json();

		expect(listResponse.status).toBe(200);
		expect(listBody.data.map(item => item.attachmentId)).toEqual([1]);

		const guessed = await apiRequest('/emails/1/attachments/2');
		expect(guessed.status).toBe(404);

		const otherUser = await apiRequest('/emails/2/attachments/2');
		expect(otherUser.status).toBe(404);

		const download = await apiRequest('/emails/1/attachments/1');
		expect(download.status).toBe(200);
		expect(await download.text()).toBe('owned attachment');
		expect(download.headers.get('Content-Type')).toContain('text/plain');
		expect(download.headers.get('Content-Disposition')).toContain('owned.txt');
		expect(download.headers.get('Cache-Control')).toBe('private, no-store');
	});

	it('maps legacy validation errors to HTTP 400', async () => {
		const response = await apiRequest('/accounts', USER_ONE_KEY, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				email: 'outside@outside.test'
			})
		});

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe('BAD_REQUEST');
	});

	it('creates and deletes a child account owned by the API key user', async () => {
		const createResponse = await apiRequest('/accounts', USER_ONE_KEY, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				email: 'automation@example.test'
			})
		});
		const createBody = await createResponse.json();

		expect(createResponse.status).toBe(201);
		expect(createBody.data.email).toBe('automation@example.test');

		const stored = await env.db
			.prepare(`SELECT user_id, is_del FROM account WHERE account_id = ?`)
			.bind(createBody.data.accountId)
			.first();
		expect(stored.user_id).toBe(1);
		expect(stored.is_del).toBe(0);

		const deleteResponse = await apiRequest(
			`/accounts/${createBody.data.accountId}`,
			USER_ONE_KEY,
			{ method: 'DELETE' }
		);
		expect(deleteResponse.status).toBe(200);

		const deleted = await env.db
			.prepare(`SELECT is_del FROM account WHERE account_id = ?`)
			.bind(createBody.data.accountId)
			.first();
		expect(deleted.is_del).toBe(1);
	});

	it('protects the primary account and hides another user account', async () => {
		const primary = await apiRequest('/accounts/1', USER_ONE_KEY, {
			method: 'DELETE'
		});
		expect(primary.status).toBe(409);

		const otherUser = await apiRequest('/accounts/3', USER_ONE_KEY, {
			method: 'DELETE'
		});
		expect(otherUser.status).toBe(404);
	});

	it('soft-deletes only an owned email', async () => {
		const otherUser = await apiRequest('/emails/2', USER_ONE_KEY, {
			method: 'DELETE'
		});
		expect(otherUser.status).toBe(404);

		const own = await apiRequest('/emails/1', USER_ONE_KEY, {
			method: 'DELETE'
		});
		expect(own.status).toBe(200);

		const row = await env.db
			.prepare(`SELECT is_del FROM email WHERE email_id = 1`)
			.first();
		expect(row.is_del).toBe(1);
	});

	it('rejects a page limit above 50', async () => {
		const response = await apiRequest('/emails?limit=51');
		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe('BAD_REQUEST');
	});
});