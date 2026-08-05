ALTER TABLE setting ADD COLUMN rest_api_enabled INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS api_key (
	api_key_id INTEGER PRIMARY KEY AUTOINCREMENT,
	public_id TEXT NOT NULL,
	user_id INTEGER NOT NULL,
	name TEXT NOT NULL COLLATE NOCASE,
	key_hash TEXT NOT NULL,
	key_prefix TEXT NOT NULL,
	status INTEGER NOT NULL DEFAULT 0,
	create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	last_used_time DATETIME,
	revoke_time DATETIME
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_key_public_id
	ON api_key (public_id);

CREATE INDEX IF NOT EXISTS idx_api_key_user_status
	ON api_key (user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_key_user_active_name
	ON api_key (user_id, name COLLATE NOCASE)
	WHERE status = 0;