-- Initialize a new PostgreSQL database once through docker-entrypoint-initdb.d.
-- Existing database volumes are left unchanged on later starts.
\set ON_ERROR_STOP on
\getenv runtime_password APP_DB_PASSWORD

BEGIN;
CREATE SCHEMA workify;

-- Core tables and triggers.
-- Workflow authorization and cross-entity status transitions belong to services.

CREATE FUNCTION workify.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE FUNCTION workify.reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$;

CREATE TABLE workify.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email varchar(254) NOT NULL CHECK (email = btrim(email) AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
    username varchar(40) NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,40}$'),
    password_hash text NOT NULL CHECK (btrim(password_hash) <> ''),
    role varchar(10) NOT NULL DEFAULT 'CLIENT' CHECK (role IN ('CLIENT', 'ADMIN')),
    status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'BLOCKED')),
    blocked_by uuid REFERENCES workify.users(id) ON DELETE RESTRICT,
    blocked_at timestamptz,
    blocked_until timestamptz,
    block_reason text,
    last_unblocked_at timestamptz,
    last_online_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_block_state_ck CHECK (
        (status = 'ACTIVE' AND blocked_by IS NULL AND blocked_at IS NULL AND blocked_until IS NULL AND block_reason IS NULL)
        OR (status = 'BLOCKED' AND blocked_by IS NOT NULL AND blocked_at IS NOT NULL
            AND block_reason IS NOT NULL AND btrim(block_reason) <> ''
            AND (blocked_until IS NULL OR blocked_until > blocked_at))
    ),
    CHECK (updated_at >= created_at)
);
CREATE UNIQUE INDEX users_email_ci_uq ON workify.users (lower(email));
CREATE UNIQUE INDEX users_username_ci_uq ON workify.users (lower(username));

CREATE TABLE workify.profiles (
    user_id uuid PRIMARY KEY REFERENCES workify.users(id) ON DELETE RESTRICT,
    first_name varchar(100) NOT NULL CHECK (btrim(first_name) <> ''),
    last_name varchar(100) NOT NULL CHECK (btrim(last_name) <> ''),
    headline varchar(200) NOT NULL DEFAULT '',
    description text NOT NULL DEFAULT '',
    phone varchar(30),
    city varchar(100),
    country varchar(100),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (updated_at >= created_at)
);

CREATE TABLE workify.skills (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug varchar(80) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name varchar(100) NOT NULL CHECK (btrim(name) <> ''),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workify.user_skills (
    user_id uuid NOT NULL REFERENCES workify.users(id) ON DELETE RESTRICT,
    skill_id uuid NOT NULL REFERENCES workify.skills(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, skill_id)
);

CREATE TABLE workify.portfolio_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES workify.users(id) ON DELETE RESTRICT,
    title varchar(200) NOT NULL CHECK (btrim(title) <> ''),
    description text NOT NULL CHECK (btrim(description) <> ''),
    links text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (array_position(links, NULL) IS NULL),
    CHECK (updated_at >= created_at)
);

CREATE TABLE workify.categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug varchar(80) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name varchar(100) NOT NULL CHECK (btrim(name) <> ''),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workify.projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES workify.users(id) ON DELETE RESTRICT,
    category_id uuid REFERENCES workify.categories(id) ON DELETE RESTRICT,
    title varchar(200) NOT NULL CHECK (btrim(title) <> ''),
    description text NOT NULL DEFAULT '',
    budget numeric(12,2) CHECK (budget > 0),
    desired_deadline_at timestamptz,
    status varchar(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
    published_at timestamptz,
    completed_at timestamptz,
    cancelled_at timestamptz,
    cancellation_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, customer_id),
    CHECK (status NOT IN ('OPEN', 'IN_PROGRESS', 'COMPLETED')
        OR (category_id IS NOT NULL AND btrim(description) <> '' AND published_at IS NOT NULL)),
    CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
    CHECK ((status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL AND btrim(cancellation_reason) <> '')
        OR (status <> 'CANCELLED' AND cancelled_at IS NULL AND cancellation_reason IS NULL)),
    CHECK (desired_deadline_at IS NULL OR desired_deadline_at > created_at),
    CHECK (published_at IS NULL OR published_at >= created_at),
    CHECK (completed_at IS NULL OR completed_at >= created_at),
    CHECK (cancelled_at IS NULL OR cancelled_at >= created_at),
    CHECK (updated_at >= created_at)
);

CREATE TABLE workify.project_skills (
    project_id uuid NOT NULL REFERENCES workify.projects(id) ON DELETE CASCADE,
    skill_id uuid NOT NULL REFERENCES workify.skills(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, skill_id)
);

CREATE TABLE workify.proposals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    freelancer_id uuid NOT NULL REFERENCES workify.users(id) ON DELETE RESTRICT,
    message text NOT NULL CHECK (btrim(message) <> ''),
    offered_price numeric(12,2) CHECK (offered_price > 0),
    offered_deadline_at timestamptz NOT NULL,
    status varchar(15) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN')),
    decided_at timestamptz,
    closure_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT proposals_project_owner_fk FOREIGN KEY (project_id, customer_id)
        REFERENCES workify.projects(id, customer_id) ON DELETE RESTRICT,
    UNIQUE (id, project_id, customer_id, freelancer_id),
    CHECK (customer_id <> freelancer_id),
    CHECK (offered_deadline_at > created_at),
    CHECK ((status = 'PENDING') = (decided_at IS NULL)),
    CHECK (decided_at IS NULL OR decided_at >= created_at),
    CHECK (updated_at >= created_at)
);
CREATE UNIQUE INDEX proposals_one_pending_uq ON workify.proposals (project_id, freelancer_id) WHERE status = 'PENDING';

CREATE TABLE workify.project_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    freelancer_id uuid NOT NULL REFERENCES workify.users(id) ON DELETE RESTRICT,
    message text NOT NULL CHECK (btrim(message) <> ''),
    offered_price numeric(12,2) CHECK (offered_price > 0),
    offered_deadline_at timestamptz NOT NULL,
    expires_at timestamptz,
    status varchar(15) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
    decided_at timestamptz,
    closure_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT invitations_project_owner_fk FOREIGN KEY (project_id, customer_id)
        REFERENCES workify.projects(id, customer_id) ON DELETE RESTRICT,
    UNIQUE (id, project_id, customer_id, freelancer_id),
    CHECK (customer_id <> freelancer_id),
    CHECK (offered_deadline_at > created_at),
    CHECK (expires_at IS NULL OR expires_at > created_at),
    CHECK ((status = 'PENDING') = (decided_at IS NULL)),
    CHECK (decided_at IS NULL OR decided_at >= created_at),
    CHECK (updated_at >= created_at)
);
CREATE UNIQUE INDEX invitations_one_pending_uq ON workify.project_invitations (project_id, freelancer_id) WHERE status = 'PENDING';

CREATE TABLE workify.orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    freelancer_id uuid NOT NULL REFERENCES workify.users(id) ON DELETE RESTRICT,
    proposal_id uuid UNIQUE,
    invitation_id uuid UNIQUE,
    title_snapshot varchar(200) NOT NULL CHECK (btrim(title_snapshot) <> ''),
    description_snapshot text NOT NULL CHECK (btrim(description_snapshot) <> ''),
    agreed_price numeric(12,2) CHECK (agreed_price > 0),
    initial_deadline_at timestamptz NOT NULL,
    deadline_at timestamptz NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'IN_PROGRESS'
        CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED', 'COMPLETED', 'CANCELLED')),
    completed_at timestamptz,
    cancelled_at timestamptz,
    cancelled_by uuid REFERENCES workify.users(id) ON DELETE RESTRICT,
    cancellation_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT orders_project_owner_fk FOREIGN KEY (project_id, customer_id)
        REFERENCES workify.projects(id, customer_id) ON DELETE RESTRICT,
    CONSTRAINT orders_proposal_context_fk FOREIGN KEY (proposal_id, project_id, customer_id, freelancer_id)
        REFERENCES workify.proposals(id, project_id, customer_id, freelancer_id) ON DELETE RESTRICT,
    CONSTRAINT orders_invitation_context_fk FOREIGN KEY (invitation_id, project_id, customer_id, freelancer_id)
        REFERENCES workify.project_invitations(id, project_id, customer_id, freelancer_id) ON DELETE RESTRICT,
    UNIQUE (id, customer_id, freelancer_id),
    UNIQUE (id, freelancer_id),
    UNIQUE (id, customer_id),
    CHECK (num_nonnulls(proposal_id, invitation_id) = 1),
    CHECK (customer_id <> freelancer_id),
    CHECK (initial_deadline_at > created_at AND deadline_at > created_at),
    CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
    CHECK (completed_at IS NULL OR completed_at >= created_at),
    CONSTRAINT orders_cancel_state_ck CHECK (
        (status = 'CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL
            AND cancelled_by IN (customer_id, freelancer_id)
            AND cancellation_reason IS NOT NULL AND btrim(cancellation_reason) <> '')
        OR (status <> 'CANCELLED' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL)
    ),
    CHECK (cancelled_at IS NULL OR cancelled_at >= created_at),
    CHECK (updated_at >= created_at)
);
CREATE UNIQUE INDEX orders_one_active_per_project_uq ON workify.orders (project_id)
    WHERE status IN ('IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED');
CREATE UNIQUE INDEX orders_one_completed_per_project_uq ON workify.orders (project_id) WHERE status = 'COMPLETED';

CREATE TABLE workify.order_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    freelancer_id uuid NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    comment text NOT NULL CHECK (btrim(comment) <> ''),
    links text[] NOT NULL DEFAULT '{}',
    status varchar(20) NOT NULL DEFAULT 'SUBMITTED'
        CHECK (status IN ('SUBMITTED', 'REVISION_REQUESTED', 'ACCEPTED', 'CANCELLED')),
    reviewed_by uuid,
    reviewed_at timestamptz,
    review_comment text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT submissions_freelancer_fk FOREIGN KEY (order_id, freelancer_id)
        REFERENCES workify.orders(id, freelancer_id) ON DELETE RESTRICT,
    CONSTRAINT submissions_customer_fk FOREIGN KEY (order_id, reviewed_by)
        REFERENCES workify.orders(id, customer_id) ON DELETE RESTRICT,
    UNIQUE (order_id, version),
    UNIQUE (id, order_id),
    CHECK (array_position(links, NULL) IS NULL),
    CHECK (
        (status = 'SUBMITTED' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_comment IS NULL)
        OR (status IN ('REVISION_REQUESTED', 'ACCEPTED') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
        OR (status = 'CANCELLED' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_comment IS NULL)
    ),
    CHECK (status <> 'REVISION_REQUESTED' OR (review_comment IS NOT NULL AND btrim(review_comment) <> '')),
    CHECK (reviewed_at IS NULL OR reviewed_at >= created_at)
);
CREATE UNIQUE INDEX submissions_one_pending_uq ON workify.order_submissions (order_id) WHERE status = 'SUBMITTED';
CREATE UNIQUE INDEX submissions_one_accepted_uq ON workify.order_submissions (order_id) WHERE status = 'ACCEPTED';

CREATE TABLE workify.order_deadline_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    freelancer_id uuid NOT NULL,
    previous_deadline_at timestamptz NOT NULL,
    proposed_deadline_at timestamptz NOT NULL,
    reason text NOT NULL CHECK (btrim(reason) <> ''),
    status varchar(15) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
    decided_by uuid,
    decided_at timestamptz,
    decision_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT deadlines_freelancer_fk FOREIGN KEY (order_id, freelancer_id)
        REFERENCES workify.orders(id, freelancer_id) ON DELETE RESTRICT,
    CONSTRAINT deadlines_customer_fk FOREIGN KEY (order_id, decided_by)
        REFERENCES workify.orders(id, customer_id) ON DELETE RESTRICT,
    UNIQUE (id, order_id),
    CHECK (previous_deadline_at <> proposed_deadline_at AND proposed_deadline_at > created_at),
    CHECK (
        (status = 'PENDING' AND decided_by IS NULL AND decided_at IS NULL AND decision_reason IS NULL)
        OR (status IN ('APPROVED', 'REJECTED') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
        OR (status = 'EXPIRED' AND decided_by IS NULL AND decided_at IS NOT NULL)
    ),
    CHECK (status NOT IN ('REJECTED', 'EXPIRED') OR (decision_reason IS NOT NULL AND btrim(decision_reason) <> '')),
    CHECK (decided_at IS NULL OR decided_at >= created_at)
);
CREATE UNIQUE INDEX deadlines_one_pending_uq ON workify.order_deadline_requests (order_id) WHERE status = 'PENDING';

CREATE TABLE workify.order_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES workify.orders(id) ON DELETE RESTRICT,
    actor_id uuid REFERENCES workify.users(id) ON DELETE RESTRICT,
    event_type varchar(40) NOT NULL CHECK (event_type IN (
        'ORDER_CREATED', 'SUBMISSION_CREATED', 'REVISION_REQUESTED', 'ORDER_COMPLETED', 'ORDER_CANCELLED',
        'DEADLINE_REQUESTED', 'DEADLINE_APPROVED', 'DEADLINE_REJECTED', 'DEADLINE_EXPIRED'
    )),
    submission_id uuid,
    deadline_request_id uuid,
    metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (submission_id, order_id) REFERENCES workify.order_submissions(id, order_id) ON DELETE RESTRICT,
    FOREIGN KEY (deadline_request_id, order_id) REFERENCES workify.order_deadline_requests(id, order_id) ON DELETE RESTRICT
);

CREATE TABLE workify.reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    freelancer_id uuid NOT NULL,
    author_id uuid NOT NULL,
    recipient_id uuid NOT NULL,
    rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    text text NOT NULL CHECK (btrim(text) <> ''),
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (order_id, customer_id, freelancer_id)
        REFERENCES workify.orders(id, customer_id, freelancer_id) ON DELETE RESTRICT,
    UNIQUE (order_id, author_id),
    CHECK ((author_id = customer_id AND recipient_id = freelancer_id)
        OR (author_id = freelancer_id AND recipient_id = customer_id)),
    CHECK (deleted_at IS NULL OR deleted_at >= created_at),
    CHECK (updated_at >= created_at)
);

CREATE TABLE workify.complaints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    freelancer_id uuid NOT NULL,
    reporter_id uuid NOT NULL,
    target_id uuid NOT NULL,
    reason varchar(80) NOT NULL CHECK (btrim(reason) <> ''),
    description text NOT NULL CHECK (btrim(description) <> ''),
    status varchar(15) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'IN_REVIEW', 'RESOLVED', 'REJECTED')),
    assigned_admin_id uuid REFERENCES workify.users(id) ON DELETE RESTRICT,
    claimed_at timestamptz,
    resolved_at timestamptz,
    resolution_note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (order_id, customer_id, freelancer_id)
        REFERENCES workify.orders(id, customer_id, freelancer_id) ON DELETE RESTRICT,
    UNIQUE (order_id, reporter_id),
    CHECK ((reporter_id = customer_id AND target_id = freelancer_id)
        OR (reporter_id = freelancer_id AND target_id = customer_id)),
    CHECK ((status = 'NEW' AND assigned_admin_id IS NULL AND claimed_at IS NULL)
        OR (status <> 'NEW' AND assigned_admin_id IS NOT NULL AND claimed_at IS NOT NULL)),
    CHECK ((status IN ('NEW', 'IN_REVIEW') AND resolved_at IS NULL AND resolution_note IS NULL)
        OR (status IN ('RESOLVED', 'REJECTED') AND resolved_at IS NOT NULL AND resolution_note IS NOT NULL AND btrim(resolution_note) <> '')),
    CHECK (claimed_at IS NULL OR claimed_at >= created_at),
    CHECK (resolved_at IS NULL OR resolved_at >= claimed_at),
    CHECK (updated_at >= created_at)
);

CREATE TABLE workify.moderation_actions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    complaint_id uuid REFERENCES workify.complaints(id) ON DELETE RESTRICT,
    admin_id uuid NOT NULL REFERENCES workify.users(id) ON DELETE RESTRICT,
    target_id uuid REFERENCES workify.users(id) ON DELETE RESTRICT,
    action_type varchar(20) NOT NULL CHECK (action_type IN ('REJECT', 'WARNING', 'TEMPORARY_BLOCK', 'PERMANENT_BLOCK')),
    reason text NOT NULL CHECK (btrim(reason) <> ''),
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, target_id, admin_id, action_type),
    CHECK ((action_type = 'REJECT' AND complaint_id IS NOT NULL AND target_id IS NULL)
        OR (action_type <> 'REJECT' AND target_id IS NOT NULL)),
    CHECK ((action_type = 'TEMPORARY_BLOCK' AND expires_at IS NOT NULL AND expires_at > created_at)
        OR (action_type = 'WARNING' AND (expires_at IS NULL OR expires_at > created_at))
        OR (action_type IN ('REJECT', 'PERMANENT_BLOCK') AND expires_at IS NULL))
);
CREATE UNIQUE INDEX moderation_one_rejection_uq ON workify.moderation_actions (complaint_id) WHERE action_type = 'REJECT';
CREATE UNIQUE INDEX moderation_one_action_per_target_uq ON workify.moderation_actions (complaint_id, target_id, action_type)
    WHERE complaint_id IS NOT NULL AND target_id IS NOT NULL;

CREATE TABLE workify.warnings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    moderation_action_id uuid NOT NULL UNIQUE,
    user_id uuid NOT NULL,
    issued_by uuid NOT NULL,
    action_type varchar(20) NOT NULL DEFAULT 'WARNING' CHECK (action_type = 'WARNING'),
    message text NOT NULL CHECK (btrim(message) <> ''),
    expires_at timestamptz,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (moderation_action_id, user_id, issued_by, action_type)
        REFERENCES workify.moderation_actions(id, target_id, admin_id, action_type) ON DELETE RESTRICT,
    CHECK (expires_at IS NULL OR expires_at > created_at),
    CHECK (read_at IS NULL OR read_at >= created_at)
);

CREATE TABLE workify.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id uuid NOT NULL REFERENCES workify.users(id) ON DELETE RESTRICT,
    event_type varchar(40) NOT NULL CHECK (event_type IN (
        'PROPOSAL_CREATED', 'PROPOSAL_STATUS_CHANGED', 'INVITATION_CREATED', 'INVITATION_STATUS_CHANGED',
        'ORDER_CREATED', 'DEADLINE_REQUESTED', 'DEADLINE_DECIDED', 'SUBMISSION_CREATED', 'REVISION_REQUESTED',
        'ORDER_COMPLETED', 'ORDER_CANCELLED', 'COMPLAINT_IN_REVIEW', 'COMPLAINT_RESOLVED', 'MODERATION_ACTION'
    )),
    project_id uuid REFERENCES workify.projects(id) ON DELETE RESTRICT,
    proposal_id uuid REFERENCES workify.proposals(id) ON DELETE RESTRICT,
    invitation_id uuid REFERENCES workify.project_invitations(id) ON DELETE RESTRICT,
    order_id uuid REFERENCES workify.orders(id) ON DELETE RESTRICT,
    complaint_id uuid REFERENCES workify.complaints(id) ON DELETE RESTRICT,
    moderation_action_id uuid REFERENCES workify.moderation_actions(id) ON DELETE RESTRICT,
    message text NOT NULL CHECK (btrim(message) <> ''),
    metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(project_id, proposal_id, invitation_id, order_id, complaint_id, moderation_action_id) >= 1),
    CHECK (read_at IS NULL OR read_at >= created_at)
);

CREATE TABLE workify.audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid REFERENCES workify.users(id) ON DELETE RESTRICT,
    action varchar(80) NOT NULL CHECK (btrim(action) <> ''),
    entity_type varchar(80) NOT NULL CHECK (btrim(entity_type) <> ''),
    entity_id uuid,
    metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
    old_data jsonb CHECK (jsonb_typeof(old_data) = 'object'),
    new_data jsonb CHECK (jsonb_typeof(new_data) = 'object'),
    ip_address inet,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workify.stored_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    uploaded_by uuid NOT NULL REFERENCES workify.users(id) ON DELETE RESTRICT,
    storage_key varchar(200) NOT NULL UNIQUE
        CHECK (storage_key ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$' AND position('..' IN storage_key) = 0),
    original_name varchar(255) NOT NULL CHECK (btrim(original_name) <> ''),
    mime_type varchar(150) NOT NULL CHECK (mime_type ~ '^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$'),
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workify.profile_files (
    user_id uuid PRIMARY KEY REFERENCES workify.profiles(user_id) ON DELETE CASCADE,
    file_id uuid NOT NULL UNIQUE REFERENCES workify.stored_files(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workify.portfolio_files (
    portfolio_item_id uuid NOT NULL REFERENCES workify.portfolio_items(id) ON DELETE CASCADE,
    file_id uuid NOT NULL REFERENCES workify.stored_files(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (portfolio_item_id, file_id)
);

CREATE TABLE workify.project_files (
    project_id uuid NOT NULL REFERENCES workify.projects(id) ON DELETE CASCADE,
    file_id uuid NOT NULL REFERENCES workify.stored_files(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, file_id)
);

CREATE TABLE workify.order_files (
    order_id uuid NOT NULL REFERENCES workify.orders(id) ON DELETE RESTRICT,
    file_id uuid NOT NULL REFERENCES workify.stored_files(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (order_id, file_id)
);

CREATE TABLE workify.submission_files (
    submission_id uuid NOT NULL REFERENCES workify.order_submissions(id) ON DELETE RESTRICT,
    file_id uuid NOT NULL REFERENCES workify.stored_files(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (submission_id, file_id)
);

CREATE TABLE workify.complaint_files (
    complaint_id uuid NOT NULL REFERENCES workify.complaints(id) ON DELETE RESTRICT,
    file_id uuid NOT NULL REFERENCES workify.stored_files(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (complaint_id, file_id)
);

-- Mechanical timestamps only; no hidden workflow changes in triggers.
DO $$
DECLARE
    relation_name text;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY[
        'users', 'profiles', 'portfolio_items', 'projects', 'proposals',
        'project_invitations', 'orders', 'reviews', 'complaints'
    ] LOOP
        EXECUTE format('CREATE TRIGGER touch_updated_at BEFORE UPDATE ON workify.%I FOR EACH ROW EXECUTE FUNCTION workify.touch_updated_at()', relation_name);
    END LOOP;
    FOREACH relation_name IN ARRAY ARRAY['order_events', 'audit_logs', 'moderation_actions'] LOOP
        EXECUTE format('CREATE TRIGGER reject_history_mutation BEFORE UPDATE OR DELETE ON workify.%I FOR EACH ROW EXECUTE FUNCTION workify.reject_history_mutation()', relation_name);
        EXECUTE format('CREATE TRIGGER reject_history_truncate BEFORE TRUNCATE ON workify.%I FOR EACH STATEMENT EXECUTE FUNCTION workify.reject_history_mutation()', relation_name);
    END LOOP;
END;
$$;

-- Indexes and views.
-- Secondary indexes support the planned repository queries and FK lookups.
CREATE INDEX users_status_created_idx ON workify.users (status, created_at DESC, id);
CREATE INDEX user_skills_skill_idx ON workify.user_skills (skill_id, user_id);
CREATE INDEX portfolio_user_created_idx ON workify.portfolio_items (user_id, created_at DESC, id);
CREATE INDEX projects_customer_created_idx ON workify.projects (customer_id, created_at DESC, id);
CREATE INDEX projects_open_category_idx ON workify.projects (category_id, published_at DESC, id) WHERE status = 'OPEN';
CREATE INDEX projects_open_recent_idx ON workify.projects (published_at DESC, id) WHERE status = 'OPEN';
CREATE INDEX projects_search_idx ON workify.projects USING gin (to_tsvector('russian', title || ' ' || description)) WHERE status = 'OPEN';
CREATE INDEX project_skills_skill_idx ON workify.project_skills (skill_id, project_id);
CREATE INDEX proposals_project_status_idx ON workify.proposals (project_id, status, created_at DESC, id);
CREATE INDEX proposals_freelancer_idx ON workify.proposals (freelancer_id, created_at DESC, id);
CREATE INDEX invitations_project_status_idx ON workify.project_invitations (project_id, status, created_at DESC, id);
CREATE INDEX invitations_freelancer_status_idx ON workify.project_invitations (freelancer_id, status, created_at DESC, id);
CREATE INDEX invitations_expiration_idx ON workify.project_invitations (expires_at) WHERE status = 'PENDING' AND expires_at IS NOT NULL;
CREATE INDEX orders_project_created_idx ON workify.orders (project_id, created_at DESC, id);
CREATE INDEX orders_customer_status_idx ON workify.orders (customer_id, status, created_at DESC, id);
CREATE INDEX orders_freelancer_status_idx ON workify.orders (freelancer_id, status, created_at DESC, id);
CREATE INDEX order_events_timeline_idx ON workify.order_events (order_id, created_at, id);
CREATE INDEX order_events_submission_idx ON workify.order_events (submission_id) WHERE submission_id IS NOT NULL;
CREATE INDEX order_events_deadline_idx ON workify.order_events (deadline_request_id) WHERE deadline_request_id IS NOT NULL;
CREATE INDEX deadline_requests_order_created_idx ON workify.order_deadline_requests (order_id, created_at DESC, id);
CREATE INDEX reviews_recipient_idx ON workify.reviews (recipient_id, created_at DESC, id);
CREATE INDEX reviews_author_idx ON workify.reviews (author_id, created_at DESC, id);
CREATE INDEX complaints_reporter_idx ON workify.complaints (reporter_id, status, created_at DESC, id);
CREATE INDEX complaints_target_idx ON workify.complaints (target_id, created_at DESC, id);
CREATE INDEX complaints_queue_idx ON workify.complaints (status, created_at, id);
CREATE INDEX complaints_assigned_idx ON workify.complaints (assigned_admin_id, status, created_at, id);
CREATE INDEX moderation_complaint_idx ON workify.moderation_actions (complaint_id, created_at, id);
CREATE INDEX moderation_target_idx ON workify.moderation_actions (target_id, created_at DESC, id);
CREATE INDEX moderation_admin_idx ON workify.moderation_actions (admin_id, created_at DESC, id);
CREATE INDEX warnings_user_created_idx ON workify.warnings (user_id, created_at DESC, id);
CREATE INDEX notifications_recipient_created_idx ON workify.notifications (recipient_id, created_at DESC, id);
CREATE INDEX notifications_unread_idx ON workify.notifications (recipient_id, created_at DESC, id) WHERE read_at IS NULL;
CREATE INDEX notifications_project_idx ON workify.notifications (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX notifications_proposal_idx ON workify.notifications (proposal_id) WHERE proposal_id IS NOT NULL;
CREATE INDEX notifications_invitation_idx ON workify.notifications (invitation_id) WHERE invitation_id IS NOT NULL;
CREATE INDEX notifications_order_idx ON workify.notifications (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX notifications_complaint_idx ON workify.notifications (complaint_id) WHERE complaint_id IS NOT NULL;
CREATE INDEX notifications_moderation_idx ON workify.notifications (moderation_action_id) WHERE moderation_action_id IS NOT NULL;
CREATE INDEX audit_logs_created_idx ON workify.audit_logs (created_at DESC, id);
CREATE INDEX audit_logs_entity_idx ON workify.audit_logs (entity_type, entity_id, created_at DESC, id);
CREATE INDEX audit_logs_actor_idx ON workify.audit_logs (actor_id, created_at DESC, id);
CREATE INDEX stored_files_uploader_idx ON workify.stored_files (uploaded_by, created_at DESC, id);
CREATE INDEX portfolio_files_file_idx ON workify.portfolio_files (file_id);
CREATE INDEX project_files_file_idx ON workify.project_files (file_id);
CREATE INDEX order_files_file_idx ON workify.order_files (file_id);
CREATE INDEX submission_files_file_idx ON workify.submission_files (file_id);
CREATE INDEX complaint_files_file_idx ON workify.complaint_files (file_id);

CREATE VIEW workify.v_active_orders AS
SELECT o.*, o.deadline_at < now() AS is_overdue
FROM workify.orders o
WHERE o.status IN ('IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED');

CREATE VIEW workify.v_order_history AS
SELECT o.*
FROM workify.orders o
WHERE o.status IN ('COMPLETED', 'CANCELLED');

CREATE VIEW workify.v_user_ratings AS
WITH ratings AS (
    SELECT recipient_id,
        round(avg(rating) FILTER (WHERE recipient_id = customer_id), 2) AS customer_rating,
        count(*) FILTER (WHERE recipient_id = customer_id) AS customer_review_count,
        round(avg(rating) FILTER (WHERE recipient_id = freelancer_id), 2) AS freelancer_rating,
        count(*) FILTER (WHERE recipient_id = freelancer_id) AS freelancer_review_count
    FROM workify.reviews
    WHERE deleted_at IS NULL
    GROUP BY recipient_id
)
SELECT u.id AS user_id, r.customer_rating, coalesce(r.customer_review_count, 0) AS customer_review_count,
    r.freelancer_rating, coalesce(r.freelancer_review_count, 0) AS freelancer_review_count
FROM workify.users u
LEFT JOIN ratings r ON r.recipient_id = u.id
WHERE u.role = 'CLIENT';

CREATE VIEW workify.v_public_profiles AS
SELECT u.id AS user_id, u.username, p.first_name, p.last_name, p.headline, p.description,
    p.city, p.country, pf.file_id AS avatar_file_id,
    r.customer_rating, r.customer_review_count, r.freelancer_rating, r.freelancer_review_count
FROM workify.users u
JOIN workify.profiles p ON p.user_id = u.id
JOIN workify.v_user_ratings r ON r.user_id = u.id
LEFT JOIN workify.profile_files pf ON pf.user_id = u.id
WHERE u.role = 'CLIENT'
    AND (u.status = 'ACTIVE' OR (u.blocked_until IS NOT NULL AND u.blocked_until <= now()));

CREATE VIEW workify.v_user_sanctions AS
SELECT a.id AS moderation_action_id, a.target_id AS user_id, a.admin_id, a.complaint_id,
    a.action_type, a.reason, a.created_at, a.expires_at, w.id AS warning_id, w.read_at
FROM workify.moderation_actions a
LEFT JOIN workify.warnings w ON w.moderation_action_id = a.id
WHERE a.action_type IN ('WARNING', 'TEMPORARY_BLOCK', 'PERMANENT_BLOCK');

-- Authentication sessions.
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

-- File lifecycle.
-- A deletion tombstone is durable until the volume object has been removed.
-- Older metadata can have an unknown digest; every new upload supplies SHA-256.
ALTER TABLE workify.stored_files
    ADD COLUMN sha256 varchar(64) CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    ADD COLUMN deleted_at timestamptz;
CREATE INDEX stored_files_pending_delete_idx ON workify.stored_files (deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Profile fields.
ALTER TABLE workify.profiles
    ADD COLUMN middle_name varchar(100),
    ADD COLUMN gender varchar(10) CHECK (gender IN ('Male', 'Female', 'Other'));

CREATE OR REPLACE VIEW workify.v_public_profiles AS
SELECT u.id AS user_id, u.username, p.first_name, p.last_name, p.headline, p.description,
    p.city, p.country, pf.file_id AS avatar_file_id,
    r.customer_rating, r.customer_review_count, r.freelancer_rating, r.freelancer_review_count,
    p.middle_name, p.gender, u.last_online_at
FROM workify.users u
JOIN workify.profiles p ON p.user_id = u.id
JOIN workify.v_user_ratings r ON r.user_id = u.id
LEFT JOIN workify.profile_files pf ON pf.user_id = u.id
WHERE u.role = 'CLIENT'
    AND (u.status = 'ACTIVE' OR (u.blocked_until IS NOT NULL AND u.blocked_until <= now()));

-- Portfolio and review media.
ALTER TABLE workify.portfolio_items
    ADD COLUMN experience text NOT NULL DEFAULT '' CHECK (length(experience) <= 5000),
    ADD COLUMN skills text[] NOT NULL DEFAULT '{}' CHECK (cardinality(skills) <= 50 AND array_position(skills,NULL) IS NULL);
CREATE TABLE workify.review_files (
    review_id uuid NOT NULL REFERENCES workify.reviews(id) ON DELETE CASCADE,
    file_id uuid NOT NULL REFERENCES workify.stored_files(id) ON DELETE RESTRICT,
    PRIMARY KEY (review_id,file_id)
);
CREATE INDEX review_files_file_idx ON workify.review_files(file_id);

-- Account deletion.
ALTER TABLE workify.users ADD COLUMN deleted_at timestamptz;
CREATE INDEX users_not_deleted_idx ON workify.users(created_at,id) WHERE deleted_at IS NULL;

-- Imported audit entries.
CREATE TABLE workify.audit_imported_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 digest varchar(64) NOT NULL UNIQUE CHECK (digest ~ '^[a-f0-9]{64}$'),
 imported_by uuid NOT NULL REFERENCES workify.users(id) ON DELETE RESTRICT,
 imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 original_data jsonb NOT NULL CHECK (jsonb_typeof(original_data)='object')
);
CREATE TRIGGER audit_imported_append_only BEFORE UPDATE OR DELETE ON workify.audit_imported_entries
 FOR EACH ROW EXECUTE FUNCTION workify.reject_history_mutation();

-- Reference categories and skills.
-- Reference data only: no accounts, passwords, uploads or fabricated orders.
INSERT INTO workify.categories (slug, name) VALUES
    ('web-development', 'Веб-разработка'),
    ('mobile-development', 'Мобильная разработка'),
    ('desktop-development', 'Настольные приложения'),
    ('design', 'Дизайн интерфейсов'),
    ('data-and-databases', 'Данные и базы данных'),
    ('devops', 'DevOps и инфраструктура'),
    ('testing', 'Тестирование'),
    ('automation', 'Автоматизация')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO workify.skills (slug, name) VALUES
    ('javascript', 'JavaScript'), ('typescript', 'TypeScript'),
    ('react', 'React'), ('html', 'HTML'), ('css', 'CSS'),
    ('nodejs', 'Node.js'), ('express', 'Express'),
    ('postgresql', 'PostgreSQL'), ('sql', 'SQL'),
    ('python', 'Python'), ('java', 'Java'), ('csharp', 'C#'),
    ('kotlin', 'Kotlin'), ('swift', 'Swift'),
    ('docker', 'Docker'), ('linux', 'Linux'),
    ('git', 'Git'), ('figma', 'Figma'),
    ('automated-testing', 'Автоматизированное тестирование'), ('api-design', 'Проектирование API')
ON CONFLICT (slug) DO NOTHING;

-- The API uses a separate account without schema or history management rights.
CREATE ROLE workify_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
    NOREPLICATION NOBYPASSRLS NOINHERIT;
SELECT format('ALTER ROLE workify_runtime PASSWORD %L', :'runtime_password') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO workify_runtime', current_database()) \gexec
GRANT USAGE ON SCHEMA workify TO workify_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA workify TO workify_runtime;
REVOKE UPDATE, DELETE ON workify.audit_logs, workify.order_events,
    workify.moderation_actions, workify.audit_imported_entries FROM workify_runtime;
-- Reference validation uses FOR SHARE locks, which require UPDATE permission.
REVOKE INSERT, UPDATE, DELETE ON workify.categories, workify.skills FROM workify_runtime;
GRANT UPDATE (name) ON workify.categories, workify.skills TO workify_runtime;

COMMIT;
