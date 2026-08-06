ALTER TABLE setting
	ADD COLUMN admin_rest_api_enabled INTEGER NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS idx_api_key_user_active_name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_key_user_type_active_name
	ON api_key (user_id, is_admin, name COLLATE NOCASE)
	WHERE status = 0;