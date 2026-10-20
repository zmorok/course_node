ALTER TABLE workify.users ADD COLUMN deleted_at timestamptz;
CREATE INDEX users_not_deleted_idx ON workify.users(created_at,id) WHERE deleted_at IS NULL;
