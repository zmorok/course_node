CREATE TABLE workify.audit_imported_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 digest varchar(64) NOT NULL UNIQUE CHECK (digest ~ '^[a-f0-9]{64}$'),
 imported_by uuid NOT NULL REFERENCES workify.users(id) ON DELETE RESTRICT,
 imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 original_data jsonb NOT NULL CHECK (jsonb_typeof(original_data)='object')
);
CREATE TRIGGER audit_imported_append_only BEFORE UPDATE OR DELETE ON workify.audit_imported_entries
 FOR EACH ROW EXECUTE FUNCTION workify.reject_history_mutation();
