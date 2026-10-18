-- Applied once, inside the transaction managed by migrate.sql.
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
