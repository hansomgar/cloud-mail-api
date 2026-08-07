import { Hono } from 'hono';
import app from '../hono/hono';
import BizError from '../error/biz-error';
import apiKeyService from '../service/api-key-service';
import restApiService from '../service/rest-api-service';
import accountArchiveService from '../service/account-archive-service';

const rest = new Hono();

function success(c, data = null, status = 200) {
	return c.json({ data }, status);
}

rest.onError((error, c) => {
	const isBusinessError = error.name === 'BizError';
	let status = isBusinessError ? Number(error.code) : 500;

	if (error instanceof SyntaxError || (isBusinessError && status === 501)) {
		status = 400;
	}
	if (!Number.isInteger(status) || status < 400 || status > 599) {
		status = isBusinessError ? 400 : 500;
	}

	const message =
		status === 500 && !isBusinessError
			? 'Internal server error'
			: error.message || 'Request failed';

	if (!isBusinessError && status === 500) {
		console.error(error);
	}

	c.header('Cache-Control', 'private, no-store');
	c.header('X-Content-Type-Options', 'nosniff');

	return c.json(
		{
			error: {
				status,
				code:
					status === 400
						? 'BAD_REQUEST'
						: status === 401
							? 'UNAUTHORIZED'
							: status === 403
								? 'FORBIDDEN'
								: status === 404
									? 'NOT_FOUND'
									: status === 409
										? 'CONFLICT'
										: 'INTERNAL_ERROR',
				message
			}
		},
		status
	);
});

rest.use('*', async (c, next) => {
	const auth = await apiKeyService.authenticate(c);
	c.set('apiAuth', auth);
	c.set('user', auth.user);
	await next();
	c.header('Cache-Control', 'private, no-store');
	c.header('X-Content-Type-Options', 'nosniff');
});

rest.get('/me', async (c) => {
	const data = await restApiService.me(c, c.get('apiAuth').userId);
	return success(c, data);
});

rest.get('/accounts', async (c) => {
	const data = await restApiService.accountList(
		c,
		c.get('apiAuth').userId,
		c.req.query()
	);
	return success(c, data);
});

rest.post('/accounts', async (c) => {
	const data = await restApiService.accountCreate(
		c,
		c.get('apiAuth').userId,
		await c.req.json()
	);
	return success(c, data, 201);
});

rest.patch('/accounts/:accountId', async (c) => {
	const data = await restApiService.accountUpdate(
		c,
		c.get('apiAuth').userId,
		c.req.param('accountId'),
		await c.req.json()
	);
	return success(c, data);
});

rest.delete('/accounts/:accountId', async (c) => {
	await restApiService.accountDelete(
		c,
		c.get('apiAuth').userId,
		c.req.param('accountId')
	);
	return success(c);
});

rest.get('/account-archives', async (c) => {
	return success(c, await accountArchiveService.list(
		c,
		c.req.query(),
		c.get('apiAuth').userId
	));
});

rest.delete('/account-archives', async (c) => {
	return success(c, await accountArchiveService.permanentDelete(
		c,
		await c.req.json(),
		c.get('apiAuth').userId
	));
});

rest.get('/emails', async (c) => {
	const data = await restApiService.emailList(
		c,
		c.get('apiAuth').userId,
		c.req.query()
	);
	return success(c, data);
});

rest.get('/emails/:emailId', async (c) => {
	const data = await restApiService.emailDetail(
		c,
		c.get('apiAuth').userId,
		c.req.param('emailId')
	);
	return success(c, data);
});

rest.patch('/emails/:emailId/read', async (c) => {
	await restApiService.emailRead(
		c,
		c.get('apiAuth').userId,
		c.req.param('emailId')
	);
	return success(c);
});

rest.delete('/emails', async (c) => {
	const data = await restApiService.emailBatchDelete(
		c,
		c.get('apiAuth').userId,
		await c.req.json()
	);
	return success(c, data);
});

rest.delete('/emails/:emailId', async (c) => {
	await restApiService.emailDelete(
		c,
		c.get('apiAuth').userId,
		c.req.param('emailId')
	);
	return success(c);
});

rest.get('/emails/:emailId/attachments', async (c) => {
	const data = await restApiService.attachmentList(
		c,
		c.get('apiAuth').userId,
		c.req.param('emailId')
	);
	return success(c, data);
});

rest.get('/emails/:emailId/attachments/:attachmentId', async (c) => {
	return restApiService.attachmentDownload(
		c,
		c.get('apiAuth').userId,
		c.req.param('emailId'),
		c.req.param('attachmentId')
	);
});

rest.use('/admin/*', async (c, next) => {
	apiKeyService.ensureAdminApi(c);
	await next();
});

rest.get('/admin/users', async (c) => {
	return success(c, await restApiService.adminUserList(c, c.req.query()));
});

rest.post('/admin/users', async (c) => {
	return success(c, await restApiService.adminUserCreate(c, await c.req.json()), 201);
});

rest.delete('/admin/users/:userId', async (c) => {
	await restApiService.adminUserDelete(c, c.req.param('userId'));
	return success(c);
});

rest.patch('/admin/users/:userId/account-limit', async (c) => {
	return success(c, await restApiService.adminUserAccountLimit(
		c,
		c.req.param('userId'),
		await c.req.json()
	));
});

rest.get('/admin/emails', async (c) => {
	return success(c, await restApiService.adminEmailList(c, c.req.query()));
});

rest.get('/admin/account-archives', async (c) => {
	return success(c, await accountArchiveService.list(
		c,
		c.req.query(),
		null,
		{ adminMode: true }
	));
});

rest.delete('/admin/account-archives', async (c) => {
	return success(c, await accountArchiveService.permanentDelete(
		c,
		await c.req.json(),
		null,
		{ adminMode: true }
	));
});

rest.patch('/admin/settings', async (c) => {
	return success(c, await restApiService.adminSettings(c, await c.req.json()));
});

rest.notFound((c) => {
	throw new BizError('REST API endpoint not found', 404);
});

app.route('/v1', rest);

export default rest;