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

async function resetDatabase() {
	await env.db.exec(`
		DROP TABLE IF EXISTS api_key;
		DROP TABLE IF EXISTS oauth;
		DROP TABLE IF EXISTS star;
		DROP TABLE IF EXISTS attachments;
		DROP TABLE IF EXISTS email;
		DROP TABLE IF EXISTS account_archive;
		DROP TABLE IF EXISTS account;
		DROP TABLE IF EXISTS role;
		DROP TABLE IF EXISTS setting;
		DROP TABLE IF EXISTS user;

		CREATE TABLE setting (
			rest_api_enabled INTEGER NOT NULL DEFAULT 1,
			admin_rest_api_enabled INTEGER NOT NULL DEFAULT 1,
			many_email INTEGER NOT NULL DEFAULT 0,
			add_email INTEGER NOT NULL DEFAULT 0
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
			account_limit INTEGER NOT NULL DEFAULT -1,
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
			archive_time DATETIME,
			is_del INTEGER NOT NULL DEFAULT 0
		);
		CREATE UNIQUE INDEX idx_account_email_nocase
			ON account (email COLLATE NOCASE);

		CREATE TABLE account_archive (
			archive_id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			account_id INTEGER NOT NULL,
			email TEXT NOT NULL COLLATE NOCASE,
			name TEXT NOT NULL DEFAULT '',
			archive_type INTEGER NOT NULL DEFAULT 1,
			create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE UNIQUE INDEX idx_account_archive_email_nocase
			ON account_archive (email COLLATE NOCASE);

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

		CREATE TABLE star (
			star_id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			email_id INTEGER NOT NULL,
			create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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

		CREATE TABLE oauth (
			oauth_id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL DEFAULT 0
		);

		CREATE TABLE api_key (
			api_key_id INTEGER PRIMARY KEY AUTOINCREMENT,
			public_id TEXT NOT NULL,
			user_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			key_prefix TEXT NOT NULL,
			api_key TEXT NOT NULL DEFAULT '',
			ip_whitelist TEXT NOT NULL DEFAULT '',
			expire_time DATETIME,
			is_admin INTEGER NOT NULL DEFAULT 0,
			status INTEGER NOT NULL DEFAULT 0,
			create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			last_used_time DATETIME,
			last_used_ip TEXT NOT NULL DEFAULT '',
			last_request TEXT NOT NULL DEFAULT '',
			revoke_time DATETIME
		);
		CREATE UNIQUE INDEX idx_api_key_user_type_active_name
			ON api_key (user_id, is_admin, name COLLATE NOCASE)
			WHERE status = 0;
	`);

	await env.db.batch([
		env.db.prepare(`
			INSERT INTO setting (rest_api_enabled, admin_rest_api_enabled)
			VALUES (0, 0)
		`),
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
				 (api_key_id, public_id, user_id, name, key_prefix, api_key, status)
				 VALUES (?, ?, ?, ?, ?, ?, 0)`
			)
			.bind(
				1,
				USER_ONE_PUBLIC_ID,
				1,
				'User one test',
				`cma_${USER_ONE_PUBLIC_ID}_AAAA…`,
				USER_ONE_KEY
			),
		env.db
			.prepare(
				`INSERT INTO api_key
				 (api_key_id, public_id, user_id, name, key_prefix, api_key, status)
				 VALUES (?, ?, ?, ?, ?, ?, 0)`
			)
			.bind(
				2,
				USER_TWO_PUBLIC_ID,
				2,
				'User two test',
				`cma_${USER_TWO_PUBLIC_ID}_BBBB…`,
				USER_TWO_KEY
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

async function setAdminApiEnabled(enabled) {
	await env.db
		.prepare(`UPDATE setting SET admin_rest_api_enabled = ?`)
		.bind(enabled ? 0 : 1)
		.run();
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
	it('creates multiple named keys, stores plaintext, and revokes keys independently', async () => {
		const context = serviceContext();
		const first = await apiKeyService.create(context, 1, {
			name: 'Home server'
		});
		const second = await apiKeyService.create(context, 1, {
			name: 'Mobile automation'
		});

		expect(first.apiKey).toMatch(/^cma_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/);
		expect(second.apiKey).not.toBe(first.apiKey);

		const stored = await env.db
			.prepare(
				`SELECT name, key_prefix, status
				 FROM api_key
				 WHERE user_id = 1 AND name IN (?, ?)
				 ORDER BY api_key_id`
			)
			.bind('Home server', 'Mobile automation')
			.all();

		expect(stored.results).toHaveLength(2);
		const plaintext = await env.db.prepare(
			`SELECT api_key FROM api_key WHERE api_key_id = ?`
		).bind(first.apiKeyId).first();
		expect(plaintext.api_key).toBe(first.apiKey);

		const status = await apiKeyService.status(serviceContext(), 1);
		const firstPublic = status.list.find(item => item.apiKeyId === first.apiKeyId);
		expect(firstPublic.apiKey).toBe(first.apiKey);

		await apiKeyService.revoke(serviceContext(), 1, first.apiKeyId);

		const revokedResponse = await apiRequest('/accounts', first.apiKey);
		const activeResponse = await apiRequest('/accounts', second.apiKey);
		expect(revokedResponse.status).toBe(401);
		expect(activeResponse.status).toBe(200);
	});

	it('enforces IP whitelist and records the last request audit', async () => {
		await env.db.prepare(
			`UPDATE api_key SET ip_whitelist = '203.0.113.10' WHERE api_key_id = 1`
		).run();

		const denied = await apiRequest('/accounts');
		expect(denied.status).toBe(403);

		const allowed = await apiRequest('/accounts', USER_ONE_KEY, {
			headers: {'CF-Connecting-IP': '203.0.113.10'}
		});
		expect(allowed.status).toBe(200);

		const audit = await env.db.prepare(
			`SELECT last_used_ip, last_used_time, last_request FROM api_key WHERE api_key_id = 1`
		).first();
		expect(audit.last_used_ip).toBe('203.0.113.10');
		expect(audit.last_used_time).toBeTruthy();
		expect(JSON.parse(audit.last_request).path).toBe('/v1/accounts');
	});

	it('rejects an expired key', async () => {
		await env.db.prepare(
			`UPDATE api_key SET expire_time = '2000-01-01 00:00:00' WHERE api_key_id = 1`
		).run();
		expect((await apiRequest('/accounts')).status).toBe(401);
	});

	it('allows an administrator key while user REST API is disabled', async () => {
		env.admin = 'one@example.test';
		await env.db.prepare(
			`UPDATE api_key SET is_admin = 1 WHERE api_key_id = 1`
		).run();
		await setApiEnabled(false);

		const response = await apiRequest('/admin/users');
		expect(response.status).toBe(200);
		expect((await response.json()).data.items).toHaveLength(2);
	});

	it('updates IP whitelist and expiration while keeping plaintext visible', async () => {
		const updated = await apiKeyService.update(serviceContext(), 1, 1, {
			name: 'Updated key',
			ipWhitelist: ['203.0.113.8', '203.0.113.9'],
			permanent: true
		});
		expect(updated.name).toBe('Updated key');
		expect(updated.ipWhitelist).toEqual(['203.0.113.8', '203.0.113.9']);
		expect(updated.apiKey).toBe(USER_ONE_KEY);
		expect(updated.permanent).toBe(true);
	});

	it('validates whitelist addresses and requires a non-permanent expiration', async () => {
		await expect(apiKeyService.create(serviceContext(), 1, {
			name: 'Bad IP',
			ipWhitelist: ['999.1.1.1']
		})).rejects.toThrow('Invalid IP address');

		await expect(apiKeyService.create(serviceContext(), 1, {
			name: 'Missing expiration',
			permanent: false
		})).rejects.toThrow('expireTime is required');
	});

	it('lets the web administrator view all plaintext keys and create an admin key', async () => {
		const context = serviceContext();
		context.set('user', {userId: 1, email: 'one@example.test'});
		env.admin = 'one@example.test';

		const listed = await apiKeyService.adminList(context);
		expect(listed.list.map(item => item.userEmail)).toEqual([
			'two@example.test',
			'one@example.test'
		]);
		expect(listed.list[0].apiKey).toBeTruthy();
		expect(listed.settings).toMatchObject({
			restApiEnabled: 0,
			adminRestApiEnabled: 0
		});

		const created = await apiKeyService.create(
			context,
			1,
			{name: 'Administrator automation', permanent: true},
			{isAdmin: true}
		);
		expect(created.isAdmin).toBe(1);
		expect(created.apiKey).toMatch(/^cma_/);
	});

	it('keeps user and administrator key management isolated', async () => {
		const context = serviceContext();
		context.set('user', {userId: 1, email: 'one@example.test'});
		env.admin = 'one@example.test';

		const adminKey = await apiKeyService.create(
			context,
			1,
			{name: 'User one test', permanent: true},
			{isAdmin: true}
		);
		const userStatus = await apiKeyService.status(serviceContext(), 1);
		expect(userStatus.list.every(item => item.isAdmin === 0)).toBe(true);
		expect(userStatus.list.some(item => item.apiKeyId === adminKey.apiKeyId)).toBe(false);

		await expect(apiKeyService.update(
			serviceContext(),
			1,
			adminKey.apiKeyId,
			{name: 'Not allowed from user page'}
		)).rejects.toThrow('API key not found');
		await expect(apiKeyService.revoke(
			serviceContext(),
			1,
			adminKey.apiKeyId
		)).rejects.toThrow('API key not found');

		const userKeys = await apiKeyService.adminList(context, {isAdmin: 0});
		const adminKeys = await apiKeyService.adminList(context, {isAdmin: 1});
		expect(userKeys.list.every(item => item.isAdmin === 0)).toBe(true);
		expect(adminKeys.list.every(item => item.isAdmin === 1)).toBe(true);
		expect(adminKeys.list.some(item => item.apiKeyId === adminKey.apiKeyId)).toBe(true);
	});

	it('redacts secrets from the recorded request body', async () => {
		await apiRequest('/accounts', USER_ONE_KEY, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'CF-Connecting-IP': '203.0.113.20'
			},
			body: JSON.stringify({
				email: 'audit@example.test',
				password: 'must-not-be-recorded',
				apiKey: 'must-not-be-recorded'
			})
		});
		const row = await env.db.prepare(
			`SELECT last_request FROM api_key WHERE api_key_id = 1`
		).first();
		const request = JSON.parse(row.last_request);
		const body = JSON.parse(request.body);
		expect(body.password).toBe('[REDACTED]');
		expect(body.apiKey).toBe('[REDACTED]');
	});
});

describe('Cloud Mail administrator REST API', () => {
	beforeEach(async () => {
		env.admin = 'one@example.test';
		await env.db.prepare(
			`UPDATE api_key SET is_admin = 1 WHERE api_key_id = 1`
		).run();
	});

	it('changes global API and multi-account settings while user API is disabled', async () => {
		await setApiEnabled(false);
		const response = await apiRequest('/admin/settings', USER_ONE_KEY, {
			method: 'PATCH',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({
				restApiEnabled: 0,
				manyEmail: 1,
				addEmail: 1
			})
		});
		expect(response.status).toBe(200);
		const row = await env.db.prepare(
			`SELECT rest_api_enabled, many_email, add_email FROM setting`
		).first();
		expect(row).toMatchObject({
			rest_api_enabled: 0,
			many_email: 1,
			add_email: 1
		});
	});

	it('sets a per-user account limit and filters all-site email', async () => {
		const limitResponse = await apiRequest(
			'/admin/users/2/account-limit',
			USER_ONE_KEY,
			{
				method: 'PATCH',
				headers: {'Content-Type': 'application/json'},
				body: JSON.stringify({accountLimit: 25})
			}
		);
		expect(limitResponse.status).toBe(200);
		expect((await env.db.prepare(
			`SELECT account_limit FROM user WHERE user_id = 2`
		).first()).account_limit).toBe(25);

		const emails = await apiRequest('/admin/emails?userId=2');
		const emailBody = await emails.json();
		expect(emails.status).toBe(200);
		expect(emailBody.data.items.map(item => item.emailId)).toEqual([2]);
	});

	it('creates and physically deletes a user with related data', async () => {
		const create = await apiRequest('/admin/users', USER_ONE_KEY, {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({
				email: 'managed@example.test',
				type: 1,
				password: 'ChangeMe123!'
			})
		});
		const created = await create.json();
		expect(create.status).toBe(201);
		expect(created.data.email).toBe('managed@example.test');

		const remove = await apiRequest(
			`/admin/users/${created.data.userId}`,
			USER_ONE_KEY,
			{method: 'DELETE'}
		);
		expect(remove.status).toBe(200);
		expect(await env.db.prepare(
			`SELECT COUNT(*) AS total FROM user WHERE user_id = ?`
		).bind(created.data.userId).first()).toMatchObject({total: 0});
	});

	it('does not allow deleting the configured administrator', async () => {
		expect((await apiRequest('/admin/users/1', USER_ONE_KEY, {
			method: 'DELETE'
		})).status).toBe(403);
	});
});

describe('Cloud Mail REST API authentication', () => {
	it('returns 403 when the administrator disables REST API access', async () => {
		await setApiEnabled(false);
		const response = await apiRequest('/accounts');

		expect(response.status).toBe(403);
		expect((await response.json()).error.code).toBe('FORBIDDEN');
	});

	it('controls user and administrator keys with independent switches', async () => {
		env.admin = 'one@example.test';
		await env.db.prepare(
			`UPDATE api_key SET is_admin = 1 WHERE api_key_id = 1`
		).run();

		await setAdminApiEnabled(false);
		expect((await apiRequest('/admin/users')).status).toBe(403);
		expect((await apiRequest('/accounts', USER_TWO_KEY)).status).toBe(200);

		await setAdminApiEnabled(true);
		await setApiEnabled(false);
		expect((await apiRequest('/admin/users')).status).toBe(200);
		expect((await apiRequest('/accounts', USER_TWO_KEY)).status).toBe(403);
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
		expect(createBody.data.items[0].email).toBe('automation@example.test');

		const stored = await env.db
			.prepare(`SELECT user_id, is_del FROM account WHERE account_id = ?`)
			.bind(createBody.data.items[0].accountId)
			.first();
		expect(stored.user_id).toBe(1);
		expect(stored.is_del).toBe(0);

		const deleteResponse = await apiRequest(
			`/accounts/${createBody.data.items[0].accountId}`,
			USER_ONE_KEY,
			{ method: 'DELETE' }
		);
		expect(deleteResponse.status).toBe(200);

		const deleted = await env.db
			.prepare(`SELECT is_del FROM account WHERE account_id = ?`)
			.bind(createBody.data.items[0].accountId)
			.first();
		expect(deleted.is_del).toBe(1);

		const restoreResponse = await apiRequest('/accounts', USER_ONE_KEY, {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({
				email: 'automation@example.test',
				name: 'Restored automation'
			})
		});
		const restored = await restoreResponse.json();
		expect(restoreResponse.status).toBe(201);
		expect(restored.data.items[0].accountId).toBe(createBody.data.items[0].accountId);
		expect(restored.data.items[0].name).toBe('Restored automation');
		expect(await env.db.prepare(
			`SELECT user_id, status, is_del FROM account WHERE account_id = ?`
		).bind(createBody.data.items[0].accountId).first()).toMatchObject({
			user_id: 1,
			status: 0,
			is_del: 0
		});
	});

	it('renames a child account immediately and finds new mail by the new name', async () => {
		const rename = await apiRequest('/accounts/2', USER_ONE_KEY, {
			method: 'PATCH',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({name: 'Renamed child'})
		});
		expect(rename.status).toBe(200);
		expect((await rename.json()).data.name).toBe('Renamed child');
		expect((await env.db.prepare(
			`SELECT name FROM account WHERE account_id = 2`
		).first()).name).toBe('Renamed child');

		await env.db.prepare(`
			INSERT INTO email
				(email_id, send_email, name, account_id, user_id, subject, text, content,
				 recipient, to_email, to_name, type, unread, is_del)
			VALUES
				(3, 'new@example.org', 'New sender', 2, 1, 'New child mail', 'Body', '<p>Body</p>',
				 '[]', 'child@example.test', 'Renamed child', 0, 0, 0)
		`).run();
		const list = await apiRequest('/emails?accountName=Renamed%20child');
		expect(list.status).toBe(200);
		expect((await list.json()).data.items.map(item => item.emailId)).toEqual([3]);
	});

	it('changes a child email address separately from its username and archives the old address', async () => {
		await env.db.prepare(`
			INSERT INTO email
				(email_id, send_email, name, account_id, user_id, subject, text, content,
				 recipient, to_email, to_name, type, unread, is_del)
			VALUES
				(3, 'old-sender@example.org', 'Old sender', 2, 1, 'Old address mail',
				 'Old', '<p>Old</p>', '[]', 'child@example.test', 'Child', 0, 0, 0)
		`).run();

		const username = await apiRequest('/accounts/2', USER_ONE_KEY, {
			method: 'PATCH',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({name: 'Display only'})
		});
		expect(username.status).toBe(200);
		expect(await env.db.prepare(
			`SELECT email, name FROM account WHERE account_id = 2`
		).first()).toMatchObject({
			email: 'child@example.test',
			name: 'Display only'
		});

		const changed = await apiRequest('/accounts/2', USER_ONE_KEY, {
			method: 'PATCH',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({email: 'renamed@example.test'})
		});
		const changedBody = await changed.json();
		expect(changed.status).toBe(200);
		expect(changedBody.data).toMatchObject({
			accountId: 2,
			email: 'renamed@example.test',
			name: 'renamed'
		});

		const archiveResponse = await apiRequest('/account-archives?archiveType=renamed');
		const archive = await archiveResponse.json();
		expect(archiveResponse.status).toBe(200);
		expect(archive.data.items).toHaveLength(1);
		expect(archive.data.items[0]).toMatchObject({
			archiveType: 'renamed',
			accountId: 2,
			email: 'child@example.test',
			name: 'Display only',
			currentEmail: 'renamed@example.test',
			primaryEmail: 'one@example.test'
		});

		await env.db.prepare(`
			INSERT INTO email
				(email_id, send_email, name, account_id, user_id, subject, text, content,
				 recipient, to_email, to_name, type, unread, is_del)
			VALUES
				(4, 'new-sender@example.org', 'New sender', 2, 1, 'New address mail',
				 'New', '<p>New</p>', '[]', 'renamed@example.test', 'renamed', 0, 0, 0)
		`).run();
		const emails = await apiRequest('/emails?accountName=renamed%40example.test');
		expect(emails.status).toBe(200);
		expect((await emails.json()).data.items.map(item => item.emailId)).toEqual([4, 3]);

		const otherUserClaim = await apiRequest('/accounts', USER_TWO_KEY, {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({email: 'child@example.test'})
		});
		expect(otherUserClaim.status).toBe(400);

		const primary = await apiRequest('/accounts/1', USER_ONE_KEY, {
			method: 'PATCH',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({email: 'new-primary@example.test'})
		});
		expect(primary.status).toBe(409);

		const mixed = await apiRequest('/accounts/2', USER_ONE_KEY, {
			method: 'PATCH',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({email: 'mixed@example.test', name: 'Mixed'})
		});
		expect(mixed.status).toBe(400);
	});

	it('permanently deletes a deleted child archive and releases its address', async () => {
		await env.db.batch([
			env.db.prepare(`
				INSERT INTO email
					(email_id, send_email, name, account_id, user_id, subject, text, content,
					 recipient, to_email, to_name, type, unread, is_del)
				VALUES
					(3, 'archive@example.org', 'Archive', 2, 1, 'Archived message',
					 'Body', '<p>Body</p>', '[]', 'child@example.test', 'Child', 0, 0, 0)
			`),
			env.db.prepare(`
				INSERT INTO attachments
					(att_id, user_id, email_id, account_id, key, filename, mime_type, size)
				VALUES
					(3, 1, 3, 2, 'attachments/archived.txt', 'archived.txt', 'text/plain', 8)
			`),
			env.db.prepare(`INSERT INTO star (star_id, user_id, email_id) VALUES (1, 1, 3)`)
		]);
		await env.kv.put('attachments/archived.txt', new TextEncoder().encode('archived'));

		expect((await apiRequest('/accounts/2', USER_ONE_KEY, {method: 'DELETE'})).status).toBe(200);
		const list = await apiRequest('/account-archives?archiveType=deleted');
		const listBody = await list.json();
		expect(list.status).toBe(200);
		expect(listBody.data.items[0]).toMatchObject({
			archiveType: 'deleted',
			archiveId: 2,
			email: 'child@example.test'
		});
		expect(listBody.data.items[0].archiveTime).toBeTruthy();

		const denied = await apiRequest('/account-archives', USER_TWO_KEY, {
			method: 'DELETE',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({
				items: [{archiveType: 'deleted', archiveId: 2}]
			})
		});
		expect(denied.status).toBe(404);
		expect(await env.db.prepare(
			`SELECT account_id FROM account WHERE account_id = 2`
		).first()).toBeTruthy();

		const removed = await apiRequest('/account-archives', USER_ONE_KEY, {
			method: 'DELETE',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({
				items: [{archiveType: 'deleted', archiveId: 2}]
			})
		});
		expect(removed.status).toBe(200);
		expect((await removed.json()).data.deleted).toBe(1);
		expect(await env.db.prepare(
			`SELECT account_id FROM account WHERE account_id = 2`
		).first()).toBeNull();
		expect(await env.db.prepare(
			`SELECT email_id FROM email WHERE email_id = 3`
		).first()).toBeNull();
		expect(await env.db.prepare(
			`SELECT att_id FROM attachments WHERE att_id = 3`
		).first()).toBeNull();
		expect(await env.db.prepare(
			`SELECT star_id FROM star WHERE star_id = 1`
		).first()).toBeNull();
		expect(await env.kv.get('attachments/archived.txt')).toBeNull();

		const claimed = await apiRequest('/accounts', USER_TWO_KEY, {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({email: 'child@example.test'})
		});
		expect(claimed.status).toBe(201);
		expect((await claimed.json()).data.items[0].email).toBe('child@example.test');
		expect((await env.db.prepare(
			`SELECT user_id FROM account WHERE email = 'child@example.test'`
		).first()).user_id).toBe(2);
	});

	it('permanently deletes only old-address history from a renamed archive', async () => {
		await env.db.batch([
			env.db.prepare(`
				INSERT INTO email
					(email_id, send_email, name, account_id, user_id, subject, text, content,
					 recipient, to_email, to_name, type, unread, is_del)
				VALUES
					(3, 'old@example.org', 'Old', 2, 1, 'Old history',
					 'Old', '<p>Old</p>', '[]', 'child@example.test', 'Child', 0, 0, 0)
			`),
			env.db.prepare(`
				INSERT INTO attachments
					(att_id, user_id, email_id, account_id, key, filename, mime_type, size)
				VALUES
					(3, 1, 3, 2, 'attachments/old-history.txt', 'old.txt', 'text/plain', 3)
			`),
			env.db.prepare(`INSERT INTO star (star_id, user_id, email_id) VALUES (1, 1, 3)`)
		]);
		await env.kv.put('attachments/old-history.txt', new TextEncoder().encode('old'));

		const rename = await apiRequest('/accounts/2', USER_ONE_KEY, {
			method: 'PATCH',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({email: 'current@example.test'})
		});
		expect(rename.status).toBe(200);
		await env.db.prepare(`
			INSERT INTO email
				(email_id, send_email, name, account_id, user_id, subject, text, content,
				 recipient, to_email, to_name, type, unread, is_del)
			VALUES
				(4, 'new@example.org', 'New', 2, 1, 'Current history',
				 'New', '<p>New</p>', '[]', 'current@example.test', 'current', 0, 0, 0)
		`).run();

		const archives = await apiRequest('/account-archives?archiveType=renamed');
		const archive = (await archives.json()).data.items[0];
		const removed = await apiRequest('/account-archives', USER_ONE_KEY, {
			method: 'DELETE',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({
				items: [{archiveType: 'renamed', archiveId: archive.archiveId}]
			})
		});
		expect(removed.status).toBe(200);
		expect(await env.db.prepare(`SELECT email_id FROM email WHERE email_id = 3`).first()).toBeNull();
		expect(await env.db.prepare(`SELECT att_id FROM attachments WHERE att_id = 3`).first()).toBeNull();
		expect(await env.db.prepare(`SELECT star_id FROM star WHERE star_id = 1`).first()).toBeNull();
		expect(await env.kv.get('attachments/old-history.txt')).toBeNull();
		expect(await env.db.prepare(`SELECT email_id FROM email WHERE email_id = 4`).first()).toBeTruthy();
		expect(await env.db.prepare(
			`SELECT email, name, is_del FROM account WHERE account_id = 2`
		).first()).toMatchObject({
			email: 'current@example.test',
			name: 'current',
			is_del: 0
		});

		const released = await apiRequest('/accounts', USER_TWO_KEY, {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({email: 'child@example.test'})
		});
		expect(released.status).toBe(201);
	});

	it('validates every archive before a batch permanent delete', async () => {
		await apiRequest('/accounts/2', USER_ONE_KEY, {method: 'DELETE'});
		await env.db.prepare(`
			INSERT INTO account
				(account_id, email, name, user_id, archive_time, is_del)
			VALUES
				(4, 'other-child@example.test', 'Other child', 2, CURRENT_TIMESTAMP, 1)
		`).run();

		const denied = await apiRequest('/account-archives', USER_ONE_KEY, {
			method: 'DELETE',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({
				items: [
					{archiveType: 'deleted', archiveId: 2},
					{archiveType: 'deleted', archiveId: 4}
				]
			})
		});
		expect(denied.status).toBe(404);
		expect(await env.db.prepare(`SELECT account_id FROM account WHERE account_id = 2`).first()).toBeTruthy();
		expect(await env.db.prepare(`SELECT account_id FROM account WHERE account_id = 4`).first()).toBeTruthy();
	});

	it('lets an administrator list and permanently delete another user archive', async () => {
		env.admin = 'one@example.test';
		await env.db.prepare(`UPDATE api_key SET is_admin = 1 WHERE api_key_id = 1`).run();
		await env.db.prepare(`
			INSERT INTO account
				(account_id, email, name, user_id, archive_time, is_del)
			VALUES
				(4, 'other-child@example.test', 'Other child', 2, CURRENT_TIMESTAMP, 1)
		`).run();

		const list = await apiRequest(
			'/admin/account-archives?userId=2&archiveType=deleted',
			USER_ONE_KEY
		);
		const listBody = await list.json();
		expect(list.status).toBe(200);
		expect(listBody.data.items).toHaveLength(1);
		expect(listBody.data.items[0]).toMatchObject({
			userId: 2,
			primaryEmail: 'two@example.test',
			email: 'other-child@example.test'
		});

		const removed = await apiRequest('/admin/account-archives', USER_ONE_KEY, {
			method: 'DELETE',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({
				items: [{archiveType: 'deleted', archiveId: 4}]
			})
		});
		expect(removed.status).toBe(200);
		expect(await env.db.prepare(`SELECT account_id FROM account WHERE account_id = 4`).first()).toBeNull();
	});

	it('does not let another user reclaim a deleted email account', async () => {
		await env.db.prepare(`UPDATE account SET is_del = 1 WHERE account_id = 3`).run();
		const response = await apiRequest('/accounts', USER_ONE_KEY, {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({email: 'two@example.test'})
		});
		expect(response.status).toBe(400);
		expect(await env.db.prepare(
			`SELECT user_id, is_del FROM account WHERE account_id = 3`
		).first()).toMatchObject({user_id: 2, is_del: 1});
	});

	it('creates multiple child accounts from an array', async () => {
		const response = await apiRequest('/accounts', USER_ONE_KEY, {
			method: 'POST',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify([
				'batch-one@example.test',
				{email: 'batch-two@example.test'}
			])
		});
		const body = await response.json();
		expect(response.status).toBe(201);
		expect(body.data.items.map(item => item.email)).toEqual([
			'batch-one@example.test',
			'batch-two@example.test'
		]);
	});

	it('filters email by account name and time', async () => {
		const owned = await apiRequest(
			'/emails?accountName=One&startTime=2000-01-01%2000:00:00'
		);
		expect((await owned.json()).data.items.map(item => item.emailId)).toEqual([1]);

		const child = await apiRequest('/emails?accountName=Child');
		expect((await child.json()).data.items).toEqual([]);

		const future = await apiRequest('/emails?startTime=2999-01-01%2000:00:00');
		expect((await future.json()).data.items).toEqual([]);
	});

	it('batch-deletes only owned emails', async () => {
		const response = await apiRequest('/emails', USER_ONE_KEY, {
			method: 'DELETE',
			headers: {'Content-Type': 'application/json'},
			body: JSON.stringify({emailIds: [1, 2]})
		});
		const body = await response.json();
		expect(response.status).toBe(200);
		expect(body.data.deleted).toBe(1);

		const own = await env.db.prepare(
			`SELECT is_del FROM email WHERE email_id = 1`
		).first();
		const other = await env.db.prepare(
			`SELECT is_del FROM email WHERE email_id = 2`
		).first();
		expect(own.is_del).toBe(1);
		expect(other.is_del).toBe(0);
	});

	it('protects administrator endpoints from user keys', async () => {
		expect((await apiRequest('/admin/users')).status).toBe(403);
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