-- Refresh credentials are random tokens; only their SHA-256 digests are stored.
CREATE TABLE workify.auth_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES workify.users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
    revoked_at timestamptz,
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX auth_sessions_user_idx ON workify.auth_sessions (user_id);

CREATE TABLE workify.auth_refresh_tokens (
    token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    session_id uuid NOT NULL REFERENCES workify.auth_sessions(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    consumed_at timestamptz,
    CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);
CREATE INDEX auth_refresh_tokens_session_idx ON workify.auth_refresh_tokens (session_id);
