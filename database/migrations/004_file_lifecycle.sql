-- A deletion tombstone is durable until the volume object has been removed.
-- Older metadata can have an unknown digest; every new upload supplies SHA-256.
ALTER TABLE workify.stored_files
    ADD COLUMN sha256 varchar(64) CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    ADD COLUMN deleted_at timestamptz;
CREATE INDEX stored_files_pending_delete_idx ON workify.stored_files (deleted_at)
    WHERE deleted_at IS NOT NULL;
