UPDATE api_key
SET status = 1,
	revoke_time = COALESCE(revoke_time, CURRENT_TIMESTAMP)
WHERE api_key = '' AND status = 0;

ALTER TABLE api_key DROP COLUMN key_hash;
