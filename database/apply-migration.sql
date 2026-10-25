-- Called by migrate.sql while it holds the migration advisory lock.
-- migration is a numbered filename without .sql, e.g. 009_profile_site.
SELECT substring(:'migration' FROM '^([0-9]{3})_')::integer AS migration_version,
       substring(:'migration' FROM '^[0-9]{3}_(.+)$') AS migration_default_name
\gset

\if :{?migration_name}
\else
    \set migration_name :migration_default_name
\endif
\set migration_file migrations/ :migration .sql

SELECT NOT EXISTS (
    SELECT FROM workify.schema_migrations WHERE version = :migration_version
) AS apply_migration \gset

\if :apply_migration
    BEGIN;
    \ir :migration_file
    \if :{?migration_seed}
        \ir :migration_seed
    \endif
    INSERT INTO workify.schema_migrations (version, name)
    VALUES (:migration_version, :'migration_name');
    COMMIT;
\endif

-- Optional settings belong only to this entry, including when it was skipped.
\unset migration_name
\unset migration_seed
