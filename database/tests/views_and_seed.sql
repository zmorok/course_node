\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
    customer uuid := gen_random_uuid();
    freelancer uuid := gen_random_uuid();
    unrated uuid := gen_random_uuid();
    administrator uuid := gen_random_uuid();
    project uuid := gen_random_uuid();
    old_proposal uuid := gen_random_uuid();
    new_invitation uuid := gen_random_uuid();
    old_order uuid := gen_random_uuid();
    current_order uuid := gen_random_uuid();
    category uuid;
    rating numeric;
    review_count bigint;
    hidden_review uuid := gen_random_uuid();
BEGIN
    IF (SELECT count(*) FROM workify.categories) <> 8 OR (SELECT count(*) FROM workify.skills) <> 20 THEN
        RAISE EXCEPTION 'Expected 8 categories and 20 skills on a clean database';
    END IF;
    IF EXISTS (SELECT FROM workify.users) THEN RAISE EXCEPTION 'Seed must not create user accounts'; END IF;
    SELECT id INTO STRICT category FROM workify.categories WHERE slug = 'web-development';
    INSERT INTO workify.users (id, email, username, password_hash, role) VALUES
        (customer, 'view-customer@example.invalid', 'view_customer', 'test-only-hash', 'CLIENT'),
        (freelancer, 'view-freelancer@example.invalid', 'view_freelancer', 'test-only-hash', 'CLIENT'),
        (unrated, 'view-unrated@example.invalid', 'view_unrated', 'test-only-hash', 'CLIENT'),
        (administrator, 'view-admin@example.invalid', 'view_admin', 'test-only-hash', 'ADMIN');
    INSERT INTO workify.profiles (user_id, first_name, last_name)
        SELECT id, 'Имя', 'Фамилия' FROM workify.users;
    INSERT INTO workify.projects (id, customer_id, category_id, title, description, status, published_at, created_at)
        VALUES (project, customer, category, 'Проект', 'Условия', 'IN_PROGRESS', now() - interval '3 days', now() - interval '3 days');
    INSERT INTO workify.proposals (id, project_id, customer_id, freelancer_id, message, offered_deadline_at, status, decided_at, created_at)
        VALUES (old_proposal, project, customer, freelancer, 'Старое предложение', now() - interval '1 day', 'ACCEPTED', now() - interval '3 days', now() - interval '3 days');
    INSERT INTO workify.project_invitations (id, project_id, customer_id, freelancer_id, message, offered_deadline_at, status, decided_at, created_at)
        VALUES (new_invitation, project, customer, freelancer, 'Новое приглашение', now() - interval '1 day', 'ACCEPTED', now() - interval '2 days', now() - interval '2 days');
    INSERT INTO workify.orders (id, project_id, customer_id, freelancer_id, proposal_id, title_snapshot, description_snapshot,
        initial_deadline_at, deadline_at, status, cancelled_at, cancelled_by, cancellation_reason, created_at)
        VALUES (old_order, project, customer, freelancer, old_proposal, 'Старое задание', 'Старые условия',
        now() - interval '1 day', now() - interval '1 day', 'CANCELLED', now() - interval '2 days', customer, 'Отказ', now() - interval '3 days');
    INSERT INTO workify.orders (id, project_id, customer_id, freelancer_id, invitation_id, title_snapshot, description_snapshot,
        initial_deadline_at, deadline_at, created_at)
        VALUES (current_order, project, customer, freelancer, new_invitation, 'Новое задание', 'Новые условия',
        now() - interval '1 day', now() - interval '1 day', now() - interval '2 days');
    IF (SELECT count(*) FROM workify.v_order_history WHERE project_id = project) <> 1
        OR (SELECT count(*) FROM workify.v_active_orders WHERE project_id = project) <> 1
        OR NOT (SELECT is_overdue FROM workify.v_active_orders WHERE id = current_order) THEN
        RAISE EXCEPTION 'Active/history or overdue view is incorrect';
    END IF;
    UPDATE workify.orders SET status = 'COMPLETED', completed_at = now() WHERE id = current_order;
    UPDATE workify.projects SET status = 'COMPLETED', completed_at = now() WHERE id = project;
    IF (SELECT count(*) FROM workify.v_order_history WHERE project_id = project) <> 2
        OR EXISTS (SELECT FROM workify.v_active_orders WHERE project_id = project) THEN
        RAISE EXCEPTION 'Terminal orders must move to history without copying rows';
    END IF;
    INSERT INTO workify.reviews (id, order_id, customer_id, freelancer_id, author_id, recipient_id, rating, text) VALUES
        (hidden_review, old_order, customer, freelancer, customer, freelancer, 2, 'Отменённый заказ'),
        (gen_random_uuid(), current_order, customer, freelancer, customer, freelancer, 4, 'Завершённый заказ'),
        (gen_random_uuid(), current_order, customer, freelancer, freelancer, customer, 5, 'Отзыв заказчику');
    SELECT freelancer_rating, freelancer_review_count INTO rating, review_count FROM workify.v_user_ratings WHERE user_id = freelancer;
    IF rating IS DISTINCT FROM 3 OR review_count IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Freelancer rating must include both terminal statuses'; END IF;
    SELECT customer_rating, customer_review_count INTO rating, review_count FROM workify.v_user_ratings WHERE user_id = customer;
    IF rating IS DISTINCT FROM 5 OR review_count IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Customer rating is mixed with freelancer rating'; END IF;
    UPDATE workify.reviews SET deleted_at = now() WHERE id = hidden_review;
    SELECT freelancer_rating, freelancer_review_count INTO rating, review_count FROM workify.v_user_ratings WHERE user_id = freelancer;
    IF rating IS DISTINCT FROM 4 OR review_count IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Hidden reviews must not contribute to ratings'; END IF;
    IF NOT EXISTS (SELECT FROM workify.v_user_ratings WHERE user_id = unrated AND customer_rating IS NULL
        AND freelancer_rating IS NULL AND customer_review_count = 0 AND freelancer_review_count = 0) THEN
        RAISE EXCEPTION 'An unrated user must have NULL ratings and zero counts';
    END IF;
    IF EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'workify' AND table_name = 'v_public_profiles'
        AND column_name IN ('email', 'phone', 'password_hash', 'block_reason')) THEN
        RAISE EXCEPTION 'Public profiles expose private data';
    END IF;
    IF EXISTS (SELECT FROM workify.v_public_profiles WHERE user_id = administrator) THEN
        RAISE EXCEPTION 'Administrator is not a freelancer profile';
    END IF;
    UPDATE workify.users SET status = 'BLOCKED', blocked_by = administrator, blocked_at = now(), block_reason = 'Проверка'
        WHERE id = freelancer;
    IF EXISTS (SELECT FROM workify.v_public_profiles WHERE user_id = freelancer) THEN
        RAISE EXCEPTION 'Permanently blocked user must not appear in public search';
    END IF;
    UPDATE workify.users SET blocked_at = now() - interval '2 days', blocked_until = now() - interval '1 day' WHERE id = freelancer;
    IF NOT EXISTS (SELECT FROM workify.v_public_profiles WHERE user_id = freelancer) THEN
        RAISE EXCEPTION 'Expired temporary block must not hide a profile forever';
    END IF;
END;
$$;
\echo PASS: seed, active/history, overdue, separate ratings, hidden reviews, private fields and effective blocks
ROLLBACK;

-- Seed replay must preserve the IDs already referenced by projects and users.
BEGIN;
CREATE TEMP TABLE original_seed_ids AS SELECT id FROM workify.categories UNION ALL SELECT id FROM workify.skills;
\ir ../seeds/reference_data.sql
DO $$
BEGIN
    IF (SELECT count(*) FROM workify.categories) <> 8 OR (SELECT count(*) FROM workify.skills) <> 20
        OR EXISTS (SELECT id FROM original_seed_ids EXCEPT (SELECT id FROM workify.categories UNION ALL SELECT id FROM workify.skills)) THEN
        RAISE EXCEPTION 'Reference seed replay must not duplicate rows or replace IDs';
    END IF;
END;
$$;
\echo PASS: idempotent reference seed
ROLLBACK;
