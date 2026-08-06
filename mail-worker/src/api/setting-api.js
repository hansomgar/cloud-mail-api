import app from '../hono/hono';
import result from '../model/result';
import settingService from '../service/setting-service';
import userContext from "../security/user-context";
import BizError from '../error/biz-error';

app.put('/setting/set', async (c) => {
	const params = await c.req.json();
	const protectedFields = ['restApiEnabled', 'adminRestApiEnabled'];
	if (
		protectedFields.some(field => Object.hasOwn(params || {}, field)) &&
		userContext.getUser(c).email !== c.env.admin
	) {
		throw new BizError('Only the administrator can change REST API access', 403);
	}
	await settingService.set(c, params);
	return c.json(result.ok());
});

app.get('/setting/query', async (c) => {
	const setting = await settingService.get(c);
	return c.json(result.ok(setting));
});

app.get('/setting/websiteConfig', async (c) => {
	const setting = await settingService.websiteConfig(c);
	return c.json(result.ok(setting));
})

app.put('/setting/setBackground', async (c) => {
	const key = await settingService.setBackground(c, await c.req.json());
	return c.json(result.ok(key));
});

app.delete('/setting/deleteBackground', async (c) => {
	await settingService.deleteBackground(c);
	return c.json(result.ok());
});

app.put('/setting/setBlacklist', async (c) => {
	const setting = await settingService.setBlacklist(c, await c.req.json());
	return c.json(result.ok(setting));
})

