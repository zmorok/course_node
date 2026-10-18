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
