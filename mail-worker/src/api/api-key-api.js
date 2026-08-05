import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import apiKeyService from '../service/api-key-service';

app.get('/api-keys', async (c) => {
	const data = await apiKeyService.status(c, userContext.getUserId(c));
	return c.json(result.ok(data));
});

app.post('/api-keys', async (c) => {
	const data = await apiKeyService.create(
		c,
		userContext.getUserId(c),
		await c.req.json()
	);
	return c.json(result.ok(data), 201);
});

app.delete('/api-keys/:apiKeyId', async (c) => {
	await apiKeyService.revoke(
		c,
		userContext.getUserId(c),
		c.req.param('apiKeyId')
	);
	return c.json(result.ok());
});