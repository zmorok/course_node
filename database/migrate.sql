-- Add migration filenames in execution order. Run this file with psql -X -f.
\set migration 001_initial_schema.sql         \ir apply-migration.sql
\set migration 002_indexes_and_views.sql      \ir apply-migration.sql
\set migration 003_auth_sessions.sql          \ir apply-migration.sql
\set migration 004_file_lifecycle.sql         \ir apply-migration.sql
\set migration 005_profile_parity.sql         \ir apply-migration.sql
\set migration 006_portfolio_review_media.sql \ir apply-migration.sql
\set migration 007_account_deletion.sql       \ir apply-migration.sql
\set migration 008_audit_archive.sql          \ir apply-migration.sql

-- Basic categories and skills; repeated runs preserve existing rows.
\ir seeds/reference_data.sql
