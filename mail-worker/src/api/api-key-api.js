import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import apiKeyService from '../service/api-key-service';

app.get('/api-keys', async (c) => {
	return c.json(result.ok(await apiKeyService.status(c, userContext.getUserId(c))));
});

app.post('/api-keys', async (c) => {
	const data = await apiKeyService.create(
		c,
		userContext.getUserId(c),
		await c.req.json()
	);
	return c.json(result.ok(data), 201);
});

app.patch('/api-keys/:apiKeyId', async (c) => {
	const data = await apiKeyService.update(
		c,
		userContext.getUserId(c),
		c.req.param('apiKeyId'),
		await c.req.json()
	);
	return c.json(result.ok(data));
});

app.delete('/api-keys/:apiKeyId', async (c) => {
	await apiKeyService.revoke(c, userContext.getUserId(c), c.req.param('apiKeyId'));
	return c.json(result.ok());
});

app.use('/admin/api-keys*', async (c, next) => {
	apiKeyService.ensureWebAdmin(c);
	await next();
});

app.get('/admin/api-keys', async (c) => {
	return c.json(result.ok(await apiKeyService.adminList(c, c.req.query())));
});

app.post('/admin/api-keys', async (c) => {
	const body = await c.req.json();
	const data = await apiKeyService.create(
		c,
		body.userId || userContext.getUserId(c),
		body,
		{ isAdmin: body.isAdmin === true, bypassEnabled: true }
	);
	return c.json(result.ok(data), 201);
});

app.patch('/admin/api-keys/:apiKeyId', async (c) => {
	const data = await apiKeyService.update(
		c,
		userContext.getUserId(c),
		c.req.param('apiKeyId'),
		await c.req.json()
	);
	return c.json(result.ok(data));
});

app.delete('/admin/api-keys/:apiKeyId', async (c) => {
	await apiKeyService.revoke(c, userContext.getUserId(c), c.req.param('apiKeyId'));
	return c.json(result.ok());
});