import app from '../hono/hono';
import accountService from '../service/account-service';
import result from '../model/result';
import userContext from '../security/user-context';
import accountArchiveService from '../service/account-archive-service';

app.get('/account/list', async (c) => {
	const list = await accountService.list(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(list));
});

app.delete('/account/delete', async (c) => {
	await accountService.delete(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok());
});

app.post('/account/add', async (c) => {
	const account = await accountService.add(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(account));
});

app.put('/account/setName', async (c) => {
	const account = await accountService.setName(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(account));
});

app.put('/account/setEmail', async (c) => {
	const account = await accountService.setEmail(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(account));
});

app.get('/account/archive/list', async (c) => {
	const data = await accountArchiveService.list(
		c,
		c.req.query(),
		userContext.getUserId(c)
	);
	return c.json(result.ok(data));
});

app.delete('/account/archive/delete', async (c) => {
	const data = await accountArchiveService.permanentDelete(
		c,
		await c.req.json(),
		userContext.getUserId(c)
	);
	return c.json(result.ok(data));
});

app.get('/admin/account-archives/list', async (c) => {
	const data = await accountArchiveService.list(
		c,
		c.req.query(),
		null,
		{ adminMode: true }
	);
	return c.json(result.ok(data));
});

app.delete('/admin/account-archives/delete', async (c) => {
	const data = await accountArchiveService.permanentDelete(
		c,
		await c.req.json(),
		null,
		{ adminMode: true }
	);
	return c.json(result.ok(data));
});

app.put('/account/setAllReceive', async (c) => {
	await accountService.setAllReceive(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
});

app.put('/account/setAsTop', async (c) => {
	await accountService.setAsTop(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok());
});
