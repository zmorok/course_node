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

-- New migration: set its numbered filename without .sql, then include the helper.
\set migration 001_initial_schema
\ir apply-migration.sql

\set migration 002_indexes_and_views
-- Preserve the original ledger name and seed in this migration's transaction.
\set migration_name indexes_views_reference_data
\set migration_seed seeds/reference_data.sql
\ir apply-migration.sql

\set migration 003_auth_sessions
\ir apply-migration.sql

\set migration 004_file_lifecycle
\ir apply-migration.sql

\set migration 005_profile_parity
\ir apply-migration.sql

\set migration 006_portfolio_review_media
\ir apply-migration.sql

\set migration 007_account_deletion
\ir apply-migration.sql

\set migration 008_audit_archive
\ir apply-migration.sql

SELECT pg_advisory_unlock(173204, 2);
