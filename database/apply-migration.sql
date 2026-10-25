\set ON_ERROR_STOP on

BEGIN;
-- Serialize concurrent runners until this migration is committed or rolled back.
SELECT pg_advisory_xact_lock(173204, 2);

CREATE SCHEMA IF NOT EXISTS workify;
CREATE TABLE IF NOT EXISTS workify.schema_migrations (
    version integer PRIMARY KEY CHECK (version > 0),
    name text NOT NULL CHECK (btrim(name) <> ''),
    applied_at timestamptz NOT NULL DEFAULT now()
);

-- The numeric filename prefix is the migration's version.
SELECT split_part(:'migration', '_', 1)::integer AS migration_version \gset
SELECT NOT EXISTS (
    SELECT FROM workify.schema_migrations WHERE version = :migration_version
) AS apply_migration \gset

\if :apply_migration
    \set migration_file migrations/ :migration
    \ir :migration_file
    INSERT INTO workify.schema_migrations (version, name)
    VALUES (:migration_version, :'migration');
\endif

COMMIT;
\if :apply_migration
    \echo Applied: :migration
\else
    \echo Already applied: :migration
\endif
