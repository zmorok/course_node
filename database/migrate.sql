\set ON_ERROR_STOP on

-- Run with psql -X -f database/migrate.sql. Includes are relative to this file.
DO $$
BEGIN
    IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 THEN
        RAISE EXCEPTION 'Workify requires PostgreSQL 17';
    END IF;
END;
$$;

SELECT pg_advisory_lock(173204, 2);

BEGIN;
CREATE SCHEMA IF NOT EXISTS workify;
CREATE TABLE IF NOT EXISTS workify.schema_migrations (
    version integer PRIMARY KEY CHECK (version > 0),
    name text NOT NULL CHECK (btrim(name) <> ''),
    applied_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;

SELECT NOT EXISTS (SELECT FROM workify.schema_migrations WHERE version = 1) AS apply_001 \gset
\if :apply_001
    BEGIN;
    \ir migrations/001_initial_schema.sql
    INSERT INTO workify.schema_migrations (version, name) VALUES (1, 'initial_schema');
    COMMIT;
\endif

SELECT NOT EXISTS (SELECT FROM workify.schema_migrations WHERE version = 2) AS apply_002 \gset
\if :apply_002
    BEGIN;
    \ir migrations/002_indexes_and_views.sql
    \ir seeds/reference_data.sql
    INSERT INTO workify.schema_migrations (version, name) VALUES (2, 'indexes_views_reference_data');
    COMMIT;
\endif

SELECT pg_advisory_unlock(173204, 2);
