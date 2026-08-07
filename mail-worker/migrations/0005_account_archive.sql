ALTER TABLE account ADD COLUMN archive_time DATETIME;

UPDATE account
SET archive_time = COALESCE(create_time, CURRENT_TIMESTAMP)
WHERE is_del = 1 AND archive_time IS NULL;

CREATE TABLE IF NOT EXISTS account_archive (
	archive_id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	account_id INTEGER NOT NULL,
	email TEXT NOT NULL COLLATE NOCASE,
	name TEXT NOT NULL DEFAULT '',
	archive_type INTEGER NOT NULL DEFAULT 1,
	create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_archive_email_nocase
	ON account_archive (email COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_account_archive_user_type_time
	ON account_archive (user_id, archive_type, create_time DESC);

CREATE INDEX IF NOT EXISTS idx_account_archive_account
	ON account_archive (account_id);