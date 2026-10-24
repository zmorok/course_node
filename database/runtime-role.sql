\set ON_ERROR_STOP on
\getenv runtime_user WORKIFY_RUNTIME_USER
\getenv runtime_password WORKIFY_RUNTIME_PASSWORD

-- Cluster role setup runs as the migrator after all schema migrations.
-- Values are quoted by PostgreSQL; passwords are never returned to stdout.
SELECT current_user <> :'runtime_user' AS separate_role \gset
\if :separate_role
\else
    \echo 'Runtime role must differ from the migration owner'
    \quit 1
\endif

BEGIN;
SELECT pg_advisory_xact_lock(173204, 3);
SELECT format('CREATE ROLE %I LOGIN', :'runtime_user')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'runtime_user') \gexec
SELECT format('ALTER ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD %L', :'runtime_user', :'runtime_password') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'runtime_user') \gexec
GRANT USAGE ON SCHEMA workify TO :"runtime_user";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA workify TO :"runtime_user";
REVOKE INSERT, UPDATE, DELETE ON workify.schema_migrations FROM :"runtime_user";
REVOKE UPDATE, DELETE ON workify.audit_logs, workify.order_events,
    workify.moderation_actions, workify.audit_imported_entries FROM :"runtime_user";
-- Reference validation takes FOR SHARE locks, which require UPDATE privileges.
REVOKE INSERT, UPDATE, DELETE ON workify.categories, workify.skills FROM :"runtime_user";
GRANT UPDATE (name) ON workify.categories, workify.skills TO :"runtime_user";
COMMIT;
