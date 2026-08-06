ALTER TABLE api_key ADD COLUMN api_key TEXT NOT NULL DEFAULT '';
ALTER TABLE api_key ADD COLUMN ip_whitelist TEXT NOT NULL DEFAULT '';
ALTER TABLE api_key ADD COLUMN expire_time DATETIME;
ALTER TABLE api_key ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_key ADD COLUMN last_used_ip TEXT NOT NULL DEFAULT '';
ALTER TABLE api_key ADD COLUMN last_request TEXT NOT NULL DEFAULT '';
ALTER TABLE user ADD COLUMN account_limit INTEGER NOT NULL DEFAULT -1;

CREATE INDEX IF NOT EXISTS idx_api_key_admin_status
	ON api_key (is_admin, status);

CREATE INDEX IF NOT EXISTS idx_api_key_expire_time
	ON api_key (expire_time);