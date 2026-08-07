import BizError from '../error/biz-error';
import verifyUtils from '../utils/verify-utils';
import emailUtils from '../utils/email-utils';
import userService from './user-service';
import emailService from './email-service';
import orm from '../entity/orm';
import account from '../entity/account';
import { and, asc, eq, gt, inArray, count, sql, ne, or, lt, desc } from 'drizzle-orm';
import {accountConst, isDel, settingConst} from '../const/entity-const';
import settingService from './setting-service';
import turnstileService from './turnstile-service';
import roleService from './role-service';
import { t } from '../i18n/i18n';
import verifyRecordService from './verify-record-service';
import accountArchiveService from './account-archive-service';
import dayjs from 'dayjs';

const accountService = {

	async add(c, params, userId, options = {}) {

		const { addEmailVerify , addEmail, manyEmail, addVerifyCount, minEmailPrefix, emailPrefixFilter } = await settingService.query(c);
		const skipHumanVerification = options.skipHumanVerification === true;

		let { email, token } = params;
		email = typeof email === 'string' ? email.trim() : email;
		let requestedName;
		if (params.name !== undefined) {
			requestedName = typeof params.name === 'string' ? params.name.trim() : '';
			if (!requestedName) {
				throw new BizError('Account name must not be empty', 400);
			}
			if (requestedName.length > 30) {
				throw new BizError(t('usernameLengthLimit'), 400);
			}
		}


		if (!(addEmail === settingConst.addEmail.OPEN && manyEmail === settingConst.manyEmail.OPEN)) {
			throw new BizError(t('addAccountDisabled'));
		}


		if (!email) {
			throw new BizError(t('emptyEmail'));
		}

		if (!verifyUtils.isEmail(email)) {
			throw new BizError(t('notEmail'));
		}

		if (!c.env.domain.includes(emailUtils.getDomain(email))) {
			throw new BizError(t('notExistDomain'));
		}

		if (emailUtils.getName(email).length < minEmailPrefix) {
			throw new BizError(t('minEmailPrefix', { msg: minEmailPrefix } ));
		}

		if (emailPrefixFilter.some(content => emailUtils.getName(email).includes(content))) {
			throw new BizError(t('banEmailPrefix'));
		}

		let accountRow = await this.selectByEmailIncludeDel(c, email);
		const archivedRow = await accountArchiveService.selectByEmail(c, email);

		if (accountRow && accountRow.isDel === isDel.NORMAL) {
			throw new BizError(t('isRegAccount'));
		}
		if (
			(accountRow && Number(accountRow.userId) !== Number(userId)) ||
			(archivedRow && Number(archivedRow.userId) !== Number(userId))
		) {
			throw new BizError(t('isRegAccount'));
		}

		const userRow = await userService.selectById(c, userId);
		const roleRow = await roleService.selectById(c, userRow.type);

		if (userRow.email !== c.env.admin) {

			const accountLimit = userRow.accountLimit >= 0
				? userRow.accountLimit
				: roleRow.accountCount;
			if (accountLimit > 0) {
				const userAccountCount = await accountService.countUserAccount(c, userId)
				if(userAccountCount >= accountLimit) throw new BizError(t('accountLimit'), 403);
			}

			if(!roleService.hasAvailDomainPerm(roleRow.availDomain, email)) {
				throw new BizError(t('noDomainPermAdd'),403)
			}

		}

		let addVerifyOpen = false

		if (!skipHumanVerification && addEmailVerify === settingConst.addEmailVerify.OPEN) {
			addVerifyOpen = true
			await turnstileService.verify(c, token);
		}

		if (!skipHumanVerification && addEmailVerify === settingConst.addEmailVerify.COUNT) {
			addVerifyOpen = await verifyRecordService.isOpenAddVerify(c, addVerifyCount);
			if (addVerifyOpen) {
				await turnstileService.verify(c,token)
			}
		}


		if (accountRow) {
			accountRow = await orm(c)
				.update(account)
				.set({
					isDel: isDel.NORMAL,
					status: accountConst.status.NORMAL,
					allReceive: accountConst.allReceive.CLOSE,
					sort: 0,
					archiveTime: null,
					name: requestedName || accountRow.name || emailUtils.getName(email)
				})
				.where(and(
					eq(account.accountId, accountRow.accountId),
					eq(account.userId, userId),
					eq(account.isDel, isDel.DELETE)
				))
				.returning()
				.get();
			if (!accountRow) {
				throw new BizError(t('isRegAccount'), 409);
			}
		} else {
			accountRow = await orm(c)
				.insert(account)
				.values({
					email,
					userId,
					name: requestedName || emailUtils.getName(email)
				})
				.returning()
				.get();
		}
		if (archivedRow) {
			await accountArchiveService.consume(c, archivedRow, accountRow.accountId);
		}

		if (!skipHumanVerification && addEmailVerify === settingConst.addEmailVerify.COUNT && !addVerifyOpen) {
			const row = await verifyRecordService.increaseAddCount(c);
			addVerifyOpen = row.count >= addVerifyCount
		}

		accountRow.addVerifyOpen = addVerifyOpen
		return accountRow;
	},

	selectByEmailIncludeDel(c, email) {
		return orm(c).select().from(account).where(sql`${account.email} COLLATE NOCASE = ${email}`).get();
	},

	list(c, params, userId) {

		let { accountId, size, lastSort } = params;

		accountId = Number(accountId);
		size = Number(size);
		lastSort = Number(lastSort);

		if (size > 30) {
			size = 30;
		}

		if (!accountId) {
			accountId = 0;
		}

		if(Number.isNaN(lastSort)) {
			lastSort = 9999999999;
		}

		return orm(c).select().from(account).where(
			and(
				eq(account.userId, userId),
				eq(account.isDel, isDel.NORMAL),
					or(
						lt(account.sort, lastSort),
						and(
							eq(account.sort, lastSort),
							gt(account.accountId, accountId)
						)
					))
				)
			.orderBy(desc(account.sort), asc(account.accountId))
			.limit(size)
			.all();
	},

	async delete(c, params, userId) {

		let { accountId } = params;

		const user = await userService.selectById(c, userId);
		const accountRow = await this.selectById(c, accountId);
		if (!accountRow) {
			throw new BizError(t('noUserAccount'), 404);
		}

		if (accountRow.email === user.email) {
			throw new BizError(t('delMyAccount'));
		}

		if (accountRow.userId !== user.userId) {
			throw new BizError(t('noUserAccount'));
		}

		await orm(c).update(account).set({
			isDel: isDel.DELETE,
			allReceive: accountConst.allReceive.CLOSE,
			archiveTime: dayjs().format('YYYY-MM-DD HH:mm:ss')
		}).where(
			and(eq(account.userId, userId),
				eq(account.accountId, accountId)))
			.run();
	},

	selectById(c, accountId) {
		return orm(c).select().from(account).where(
			and(eq(account.accountId, accountId),
				eq(account.isDel, isDel.NORMAL)))
			.get();
	},

	async insert(c, params) {
		await orm(c).insert(account).values({ ...params }).returning();
	},

	async insertList(c, list) {
		await orm(c).insert(account).values(list).run();
	},

	async physicsDeleteByUserIds(c, userIds) {
		await emailService.physicsDeleteUserIds(c, userIds);
		await accountArchiveService.deleteByUserIds(c, userIds);
		await orm(c).delete(account).where(inArray(account.userId,userIds)).run();
	},

	async selectUserAccountCountList(c, userIds, del = isDel.NORMAL) {
		const result = await orm(c)
			.select({
				userId: account.userId,
				count: count(account.accountId)
			})
			.from(account)
			.where(and(
				inArray(account.userId, userIds),
				eq(account.isDel, del)
			))
			.groupBy(account.userId)
		return result;
	},

	async countUserAccount(c, userId) {
		const { num } = await orm(c).select({num: count()}).from(account).where(and(eq(account.userId, userId),eq(account.isDel, isDel.NORMAL))).get();
		return num;
	},

	async restoreByEmail(c, email) {
		await orm(c).update(account).set({
			isDel: isDel.NORMAL,
			archiveTime: null
		}).where(eq(account.email, email)).run();
	},

	async restoreByUserId(c, userId) {
		await orm(c).update(account).set({
			isDel: isDel.NORMAL,
			archiveTime: null
		}).where(eq(account.userId, userId)).run();
	},

	async setName(c, params, userId) {
		const accountId = Number(params?.accountId);
		const name = typeof params?.name === 'string' ? params.name.trim() : '';
		if (!Number.isInteger(accountId) || accountId <= 0) {
			throw new BizError('Invalid account ID', 400);
		}
		if (!name) {
			throw new BizError('Account name must not be empty', 400);
		}
		if (name.length > 30) {
			throw new BizError(t('usernameLengthLimit'), 400);
		}
		const row = await orm(c)
			.update(account)
			.set({ name })
			.where(and(
				eq(account.userId, userId),
				eq(account.accountId, accountId),
				eq(account.isDel, isDel.NORMAL)
			))
			.returning()
			.get();
		if (!row) {
			throw new BizError(t('noUserAccount'), 404);
		}
		return row;
	},

	async setEmail(c, params, userId) {
		const accountId = Number(params?.accountId);
		const email = typeof params?.email === 'string'
			? params.email.trim().toLowerCase()
			: '';
		if (!Number.isInteger(accountId) || accountId <= 0) {
			throw new BizError('Invalid account ID', 400);
		}
		if (!email || !verifyUtils.isEmail(email)) {
			throw new BizError(t('notEmail'), 400);
		}
		const current = await this.selectById(c, accountId);
		if (!current || Number(current.userId) !== Number(userId)) {
			throw new BizError(t('noUserAccount'), 404);
		}
		const userRow = await userService.selectById(c, userId);
		if (current.email.toLowerCase() === userRow.email.toLowerCase()) {
			throw new BizError('The primary account email cannot be changed', 409);
		}
		if (current.email.toLowerCase() === email) {
			throw new BizError('The new email address must be different', 400);
		}

		const { minEmailPrefix, emailPrefixFilter } = await settingService.query(c);
		const domain = emailUtils.getDomain(email);
		const prefix = emailUtils.getName(email);
		if (!c.env.domain.includes(domain)) {
			throw new BizError(t('notExistDomain'), 400);
		}
		if (prefix.length < minEmailPrefix) {
			throw new BizError(t('minEmailPrefix', { msg: minEmailPrefix }), 400);
		}
		if (emailPrefixFilter.some(content => prefix.includes(content))) {
			throw new BizError(t('banEmailPrefix'), 400);
		}
		if (userRow.email !== c.env.admin) {
			const roleRow = await roleService.selectById(c, userRow.type);
			if (!roleService.hasAvailDomainPerm(roleRow.availDomain, email)) {
				throw new BizError(t('noDomainPermAdd'), 403);
			}
		}

		const [existing, archived] = await Promise.all([
			this.selectByEmailIncludeDel(c, email),
			accountArchiveService.selectByEmail(c, email)
		]);
		if (existing && Number(existing.accountId) !== accountId) {
			throw new BizError(t('isRegAccount'), 409);
		}
		if (archived && Number(archived.userId) !== Number(userId)) {
			throw new BizError(t('isRegAccount'), 409);
		}

		const statements = [];
		if (archived && Number(archived.accountId) !== accountId) {
			statements.push(
				c.env.db.prepare(`
					UPDATE attachments
					SET account_id = ?
					WHERE email_id IN (
						SELECT email_id FROM email
						WHERE user_id = ? AND account_id = ?
						  AND (
							to_email COLLATE NOCASE = ?
							OR send_email COLLATE NOCASE = ?
						  )
					)
				`).bind(accountId, userId, archived.accountId, email, email),
				c.env.db.prepare(`
					UPDATE email
					SET account_id = ?
					WHERE user_id = ? AND account_id = ?
					  AND (
						to_email COLLATE NOCASE = ?
						OR send_email COLLATE NOCASE = ?
					  )
				`).bind(accountId, userId, archived.accountId, email, email)
			);
		}
		if (archived) {
			statements.push(
				c.env.db.prepare(`
					DELETE FROM account_archive
					WHERE archive_id = ? AND user_id = ?
				`).bind(archived.archiveId, userId)
			);
		}
		statements.push(
			c.env.db.prepare(`
				INSERT INTO account_archive
					(user_id, account_id, email, name, archive_type)
				VALUES (?, ?, ?, ?, ?)
			`).bind(
				userId,
				accountId,
				current.email,
				current.name,
				accountArchiveService.ARCHIVE_RENAMED
			),
			c.env.db.prepare(`
				UPDATE account
				SET email = ?, name = ?, archive_time = NULL
				WHERE account_id = ? AND user_id = ? AND is_del = 0
			`).bind(email, prefix, accountId, userId)
		);
		await c.env.db.batch(statements);
		return this.selectById(c, accountId);
	},

	async allAccount(c, params) {

		let { userId, num, size } = params

		userId = Number(userId)

		num = Number(num)
		size = Number(size)

		if (size > 30) {
			size = 30;
		}

		num = (num - 1) * size;

		const userRow = await userService.selectByIdIncludeDel(c, userId);

		const list = await orm(c).select().from(account).where(and(eq(account.userId, userId),ne(account.email,userRow.email))).limit(size).offset(num);
		const { total } = await orm(c).select({ total: count() }).from(account).where(eq(account.userId, userId)).get();

		return { list, total }
	},

	async physicsDelete(c, params) {
		const { accountId } = params
		await emailService.physicsDeleteByAccountId(c, accountId)
		await accountArchiveService.deleteByAccountId(c, accountId)
		await orm(c).delete(account).where(eq(account.accountId, accountId)).run();
	},

	async setAllReceive(c, params, userId) {
		let a = null
		const { accountId } = params;
		const accountRow = await this.selectById(c, accountId);
		if (accountRow.userId !== userId) {
			return;
		}
		await orm(c).update(account).set({ allReceive: accountConst.allReceive.CLOSE }).where(eq(account.userId, userId)).run();
		await orm(c).update(account).set({ allReceive: accountRow.allReceive ? 0 : 1 }).where(eq(account.accountId, accountId)).run();
	},

	async setAsTop(c, params, userId) {
		const { accountId } = params;
		const userRow = await userService.selectById(c, userId);
		const mainAccountRow = await accountService.selectByEmailIncludeDel(c, userRow.email);
		let mainSort = mainAccountRow.sort === 0 ? 2 : mainAccountRow.sort + 1;
		await orm(c).update(account).set({ sort: mainSort }).where(eq(account.email, userRow.email )).run();
		await orm(c).update(account).set({ sort: mainSort - 1 }).where(and(eq(account.accountId, accountId),eq(account.userId,userId))).run();
	}
};

export default accountService;
