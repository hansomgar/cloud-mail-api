import fs from 'node:fs';
import path from 'node:path';

const EXPECTED = Object.freeze({
	workerName: 'cloud-mail-api',
	databaseName: 'cloud-mail-api',
	databaseId: 'a99b0859-0c89-49de-8af1-a19b45c94e2c',
	kvNamespaceId: '2a56f3742be04a37a0fdf8e359023ca4',
	routePattern: 'mail.airoute.kdns.fr/*',
	zoneName: 'airoute.kdns.fr',
	mailDomains: ['mail.airoute.kdns.fr'],
	admin: 'admin@mail.airoute.kdns.fr'
});

const FORBIDDEN_PRODUCTION_IDS = Object.freeze([
	'3db1f7f8-2649-4807-8a56-66e54cf66fbc',
	'0cf1acad9b494a85a828d4c30a92b973'
]);

const root = path.resolve(import.meta.dirname, '..');
const configs = [
	path.join(root, 'wrangler.toml'),
	path.join(root, 'mail-worker', 'wrangler.toml')
];

function requiredMatch(content, expression, expected, label, file) {
	const match = content.match(expression);
	if (!match) {
		throw new Error(`${file}: missing ${label}`);
	}
	if (match[1] !== expected) {
		throw new Error(
			`${file}: unsafe ${label}; expected "${expected}", received "${match[1]}"`
		);
	}
}

for (const file of configs) {
	const relativeFile = path.relative(root, file);
	const content = fs.readFileSync(file, 'utf8');

	for (const forbiddenId of FORBIDDEN_PRODUCTION_IDS) {
		if (content.includes(forbiddenId)) {
			throw new Error(
				`${relativeFile}: contains a protected cloud-mail resource ID (${forbiddenId})`
			);
		}
	}

	requiredMatch(
		content,
		/^name\s*=\s*"([^"]+)"/m,
		EXPECTED.workerName,
		'Worker name',
		relativeFile
	);
	requiredMatch(
		content,
		/^database_name\s*=\s*"([^"]+)"/m,
		EXPECTED.databaseName,
		'D1 database name',
		relativeFile
	);
	requiredMatch(
		content,
		/^database_id\s*=\s*"([^"]+)"/m,
		EXPECTED.databaseId,
		'D1 database ID',
		relativeFile
	);
	requiredMatch(
		content,
		/^id\s*=\s*"([^"]+)"/m,
		EXPECTED.kvNamespaceId,
		'KV namespace ID',
		relativeFile
	);
	requiredMatch(
		content,
		/^pattern\s*=\s*"([^"]+)"/m,
		EXPECTED.routePattern,
		'Worker route pattern',
		relativeFile
	);
	requiredMatch(
		content,
		/^zone_name\s*=\s*"([^"]+)"/m,
		EXPECTED.zoneName,
		'Worker route zone',
		relativeFile
	);
	if (/^custom_domain\s*=\s*true\s*$/m.test(content)) {
		throw new Error(
			`${relativeFile}: custom_domain mode is forbidden because it conflicts with mail MX`
		);
	}
	requiredMatch(
		content,
		/^admin\s*=\s*"([^"]+)"/m,
		EXPECTED.admin,
		'administrator email',
		relativeFile
	);

	const domainMatch = content.match(/^domain\s*=\s*\[([^\]]+)]/m);
	const mailDomains = domainMatch
		? [...domainMatch[1].matchAll(/"([^"]+)"/g)].map(match => match[1])
		: [];
	if (
		mailDomains.length !== EXPECTED.mailDomains.length ||
		mailDomains.some((domain, index) => domain !== EXPECTED.mailDomains[index])
	) {
		throw new Error(
			`${relativeFile}: unsafe mail domains; expected ${JSON.stringify(EXPECTED.mailDomains)}`
		);
	}
}

console.log(
	`Verified Cloudflare target: ${EXPECTED.workerName} / D1 ${EXPECTED.databaseId} / KV ${EXPECTED.kvNamespaceId}`
);