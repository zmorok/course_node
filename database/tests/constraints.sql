\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE test_results (name text PRIMARY KEY);

CREATE FUNCTION pg_temp.expect_error(command text, expected_state text, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    BEGIN
        EXECUTE command;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE <> expected_state THEN
            RAISE EXCEPTION '%: expected SQLSTATE %, got %: %', label, expected_state, SQLSTATE, SQLERRM;
        END IF;
        INSERT INTO test_results VALUES (label);
        RETURN;
    END;
    RAISE EXCEPTION '%: command unexpectedly succeeded', label;
END;
$$;

CREATE FUNCTION pg_temp.assert_true(condition boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', label; END IF;
    INSERT INTO test_results VALUES (label);
END;
$$;

DO $$
DECLARE
    customer uuid := gen_random_uuid();
    freelancer uuid := gen_random_uuid();
    outsider uuid := gen_random_uuid();
    administrator uuid := gen_random_uuid();
    category uuid := gen_random_uuid();
    project uuid := gen_random_uuid();
    second_project uuid := gen_random_uuid();
    proposal uuid := gen_random_uuid();
    invitation uuid := gen_random_uuid();
    first_order uuid := gen_random_uuid();
    next_order uuid := gen_random_uuid();
    submission uuid := gen_random_uuid();
    request uuid := gen_random_uuid();
    review uuid := gen_random_uuid();
    complaint uuid := gen_random_uuid();
    warning_action uuid := gen_random_uuid();
    block_action uuid := gen_random_uuid();
    stored_file uuid := gen_random_uuid();
    audit_entry uuid := gen_random_uuid();
    event_entry uuid := gen_random_uuid();
    active_status text;
    make_order text;
BEGIN
    PERFORM pg_temp.assert_true(NOT EXISTS (
        SELECT FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'workify' AND c.contype = 'f' AND NOT c.convalidated
    ), 'all foreign keys validated');
    PERFORM pg_temp.assert_true(NOT EXISTS (
        SELECT FROM information_schema.tables WHERE table_schema = 'workify'
        AND (table_name = 'orders_archive' OR table_name LIKE '%payment%')
    ), 'no archive or payment tables');
    PERFORM pg_temp.assert_true(NOT EXISTS (
        SELECT FROM information_schema.columns WHERE table_schema = 'workify' AND data_type IN ('bytea', 'oid')
    ), 'no binary file columns');

    INSERT INTO workify.users (id, email, username, password_hash, role) VALUES
        (customer, 'stage2-customer@example.invalid', 'stage2_customer', 'test-only-hash', 'CLIENT'),
        (freelancer, 'stage2-freelancer@example.invalid', 'stage2_freelancer', 'test-only-hash', 'CLIENT'),
        (outsider, 'stage2-outsider@example.invalid', 'stage2_outsider', 'test-only-hash', 'CLIENT'),
        (administrator, 'stage2-admin@example.invalid', 'stage2_admin', 'test-only-hash', 'ADMIN');
    PERFORM pg_temp.expect_error($q$INSERT INTO workify.users (email, username, password_hash) VALUES ('STAGE2-CUSTOMER@example.invalid', 'new_user', 'test-only-hash')$q$, '23505', 'case insensitive email');
    PERFORM pg_temp.expect_error($q$INSERT INTO workify.users (email, username, password_hash) VALUES ('new@example.invalid', 'STAGE2_CUSTOMER', 'test-only-hash')$q$, '23505', 'case insensitive username');
    PERFORM pg_temp.expect_error(format('UPDATE workify.users SET role = %L WHERE id = %L', 'CUSTOMER', customer), '23514', 'customer is not an account role');
    PERFORM pg_temp.expect_error(format('UPDATE workify.users SET status = %L WHERE id = %L', 'BLOCKED', customer), '23514', 'block requires actor time reason');
    INSERT INTO workify.profiles (user_id, first_name, last_name) VALUES (customer, 'Иван', 'Заказчик');
    PERFORM pg_temp.expect_error(format('UPDATE workify.profiles SET first_name = %L WHERE user_id = %L', ' ', customer), '23514', 'nonempty profile names');
    INSERT INTO workify.categories (id, slug, name) VALUES (category, 'constraint-test', 'Тест');
    INSERT INTO workify.projects (id, customer_id, title) VALUES (project, customer, 'Задание');
    PERFORM pg_temp.expect_error(format('UPDATE workify.projects SET status = %L WHERE id = %L', 'OPEN', project), '23514', 'publication needs complete fields');
    UPDATE workify.projects SET category_id = category, description = 'Описание', status = 'OPEN', published_at = now() WHERE id = project;
    INSERT INTO workify.projects (id, customer_id, category_id, title, description, status, published_at)
        VALUES (second_project, customer, category, 'Второй проект', 'Описание', 'OPEN', now());

    INSERT INTO workify.proposals (id, project_id, customer_id, freelancer_id, message, offered_deadline_at)
        VALUES (proposal, project, customer, freelancer, 'Предложение', now() + interval '7 days');
    PERFORM pg_temp.expect_error(format('INSERT INTO workify.proposals (project_id, customer_id, freelancer_id, message, offered_deadline_at) VALUES (%L, %L, %L, %L, now() + interval ''7 days'')', project, customer, freelancer, 'Дубль'), '23505', 'one pending proposal per pair');
    PERFORM pg_temp.expect_error(format('UPDATE workify.proposals SET freelancer_id = %L WHERE id = %L', customer, proposal), '23514', 'no self proposal');
    PERFORM pg_temp.expect_error(format('UPDATE workify.proposals SET customer_id = %L WHERE id = %L', outsider, proposal), '23503', 'proposal customer owns project');
    PERFORM pg_temp.expect_error(format('UPDATE workify.proposals SET offered_price = 0 WHERE id = %L', proposal), '23514', 'positive proposed price');
    PERFORM pg_temp.expect_error(format('UPDATE workify.proposals SET offered_deadline_at = now() - interval ''1 day'' WHERE id = %L', proposal), '23514', 'future initial proposed deadline');
    UPDATE workify.proposals SET status = 'ACCEPTED', decided_at = now() WHERE id = proposal;

    INSERT INTO workify.project_invitations (id, project_id, customer_id, freelancer_id, message, offered_deadline_at)
        VALUES (invitation, project, customer, freelancer, 'Приглашение', now() + interval '8 days');
    PERFORM pg_temp.expect_error(format('INSERT INTO workify.project_invitations (project_id, customer_id, freelancer_id, message, offered_deadline_at) VALUES (%L, %L, %L, %L, now() + interval ''8 days'')', project, customer, freelancer, 'Дубль'), '23505', 'one pending invitation per pair');
    PERFORM pg_temp.expect_error(format('UPDATE workify.project_invitations SET freelancer_id = %L WHERE id = %L', customer, invitation), '23514', 'no self invitation');
    PERFORM pg_temp.expect_error(format('UPDATE workify.project_invitations SET customer_id = %L WHERE id = %L', outsider, invitation), '23503', 'invitation sender owns project');
    UPDATE workify.project_invitations SET status = 'ACCEPTED', decided_at = now() WHERE id = invitation;

    make_order := format('INSERT INTO workify.orders (project_id, customer_id, freelancer_id, invitation_id, title_snapshot, description_snapshot, initial_deadline_at, deadline_at) VALUES (%L, %L, %L, %L, ''Снимок'', ''Условия'', now() + interval ''8 days'', now() + interval ''8 days'')', project, customer, freelancer, invitation);
    PERFORM pg_temp.expect_error(format('INSERT INTO workify.orders (project_id, customer_id, freelancer_id, title_snapshot, description_snapshot, initial_deadline_at, deadline_at) VALUES (%L, %L, %L, ''Снимок'', ''Условия'', now() + interval ''7 days'', now() + interval ''7 days'')', project, customer, freelancer), '23514', 'order requires a source');
    PERFORM pg_temp.expect_error(format('INSERT INTO workify.orders (project_id, customer_id, freelancer_id, proposal_id, invitation_id, title_snapshot, description_snapshot, initial_deadline_at, deadline_at) VALUES (%L, %L, %L, %L, %L, ''Снимок'', ''Условия'', now() + interval ''7 days'', now() + interval ''7 days'')', project, customer, freelancer, proposal, invitation), '23514', 'order cannot use both sources');
    PERFORM pg_temp.expect_error(replace(make_order, quote_literal(project), quote_literal(second_project)), '23503', 'source belongs to same project');
    PERFORM pg_temp.expect_error(replace(make_order, quote_literal(freelancer), quote_literal(outsider)), '23503', 'source belongs to same freelancer');

    INSERT INTO workify.orders (id, project_id, customer_id, freelancer_id, proposal_id, title_snapshot, description_snapshot, initial_deadline_at, deadline_at)
        VALUES (first_order, project, customer, freelancer, proposal, 'Первый снимок', 'Первоначальные условия', now() + interval '7 days', now() + interval '7 days');
    FOREACH active_status IN ARRAY ARRAY['IN_PROGRESS', 'SUBMITTED', 'REVISION_REQUESTED'] LOOP
        UPDATE workify.orders SET status = active_status WHERE id = first_order;
        PERFORM pg_temp.expect_error(make_order, '23505', 'one active order while ' || active_status);
    END LOOP;
    PERFORM pg_temp.expect_error(format('UPDATE workify.orders SET status = ''CANCELLED'' WHERE id = %L', first_order), '23514', 'cancellation requires audit fields');
    PERFORM pg_temp.expect_error(format('UPDATE workify.orders SET status = ''CANCELLED'', cancelled_at = now(), cancelled_by = %L, cancellation_reason = ''Причина'' WHERE id = %L', outsider, first_order), '23514', 'only a party is cancellation actor');
    UPDATE workify.orders SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = customer, cancellation_reason = 'Нужен другой исполнитель' WHERE id = first_order;
    PERFORM pg_temp.expect_error(format('INSERT INTO workify.orders (project_id, customer_id, freelancer_id, proposal_id, title_snapshot, description_snapshot, initial_deadline_at, deadline_at) VALUES (%L, %L, %L, %L, ''Снимок'', ''Условия'', now() + interval ''7 days'', now() + interval ''7 days'')', project, customer, freelancer, proposal), '23505', 'accepted source never reused');
    INSERT INTO workify.orders (id, project_id, customer_id, freelancer_id, invitation_id, title_snapshot, description_snapshot, initial_deadline_at, deadline_at)
        VALUES (next_order, project, customer, freelancer, invitation, 'Новый снимок', 'Новые условия', now() + interval '8 days', now() + interval '8 days');
    PERFORM pg_temp.assert_true((SELECT count(*) = 2 FROM workify.orders WHERE project_id = project), 'cancelled history and new invitation order coexist');
    PERFORM pg_temp.expect_error(format('DELETE FROM workify.projects WHERE id = %L', project), '23503', 'project with history cannot be deleted');

    INSERT INTO workify.order_submissions (id, order_id, freelancer_id, version, comment, links)
        VALUES (submission, next_order, freelancer, 1, 'Результат', ARRAY['https://example.invalid/result']);
    PERFORM pg_temp.expect_error(format('UPDATE workify.order_submissions SET freelancer_id = %L WHERE id = %L', outsider, submission), '23503', 'submission author is order freelancer');
    PERFORM pg_temp.expect_error(format('INSERT INTO workify.order_submissions (order_id, freelancer_id, version, comment) VALUES (%L, %L, 2, ''Ещё сдача'')', next_order, freelancer), '23505', 'one outstanding submission');
    PERFORM pg_temp.expect_error(format('UPDATE workify.order_submissions SET status = ''ACCEPTED'', reviewed_by = %L, reviewed_at = now() WHERE id = %L', freelancer, submission), '23503', 'only customer reviews submission');
    PERFORM pg_temp.expect_error(format('UPDATE workify.order_submissions SET status = ''REVISION_REQUESTED'', reviewed_by = %L, reviewed_at = now(), review_comment = '' '' WHERE id = %L', customer, submission), '23514', 'revision requires comment');
    UPDATE workify.order_submissions SET status = 'REVISION_REQUESTED', reviewed_by = customer, reviewed_at = now(), review_comment = 'Исправить' WHERE id = submission;
    PERFORM pg_temp.expect_error(format('INSERT INTO workify.order_submissions (order_id, freelancer_id, version, comment) VALUES (%L, %L, 1, ''Дубль версии'')', next_order, freelancer), '23505', 'unique submission version');

    INSERT INTO workify.order_deadline_requests (id, order_id, freelancer_id, previous_deadline_at, proposed_deadline_at, reason)
        VALUES (request, next_order, freelancer, now() + interval '8 days', now() + interval '9 days', 'Нужен ещё день');
    PERFORM pg_temp.expect_error(format('INSERT INTO workify.order_deadline_requests (order_id, freelancer_id, previous_deadline_at, proposed_deadline_at, reason) VALUES (%L, %L, now() + interval ''8 days'', now() + interval ''10 days'', ''Дубль'')', next_order, freelancer), '23505', 'one pending deadline request');
    PERFORM pg_temp.expect_error(format('UPDATE workify.order_deadline_requests SET freelancer_id = %L WHERE id = %L', outsider, request), '23503', 'deadline requester is freelancer');
    PERFORM pg_temp.expect_error(format('UPDATE workify.order_deadline_requests SET status = ''APPROVED'', decided_by = %L, decided_at = now() WHERE id = %L', freelancer, request), '23503', 'deadline decision is customer');

    INSERT INTO workify.reviews (id, order_id, customer_id, freelancer_id, author_id, recipient_id, rating, text)
        VALUES (review, first_order, customer, freelancer, customer, freelancer, 4, 'Отзыв после отмены');
    PERFORM pg_temp.expect_error(format('UPDATE workify.reviews SET rating = 6 WHERE id = %L', review), '23514', 'rating bounded 1 to 5');
    PERFORM pg_temp.expect_error(format('UPDATE workify.reviews SET recipient_id = %L WHERE id = %L', customer, review), '23514', 'no self review');
    PERFORM pg_temp.expect_error(format('UPDATE workify.reviews SET author_id = %L WHERE id = %L', outsider, review), '23514', 'review author is a party');
    PERFORM pg_temp.expect_error(format('UPDATE workify.reviews SET customer_id = %L, author_id = %L WHERE id = %L', outsider, outsider, review), '23503', 'review context matches order');
    UPDATE workify.reviews SET deleted_at = now() WHERE id = review;
    PERFORM pg_temp.expect_error(format('INSERT INTO workify.reviews (order_id, customer_id, freelancer_id, author_id, recipient_id, rating, text) VALUES (%L, %L, %L, %L, %L, 5, ''Дубль'')', first_order, customer, freelancer, customer, freelancer), '23505', 'hidden review cannot bypass uniqueness');

    INSERT INTO workify.complaints (id, order_id, customer_id, freelancer_id, reporter_id, target_id, reason, description)
        VALUES (complaint, first_order, customer, freelancer, customer, freelancer, 'deadline', 'Описание нарушения');
    PERFORM pg_temp.expect_error(format('UPDATE workify.complaints SET target_id = %L WHERE id = %L', outsider, complaint), '23514', 'complaint target is other party');
    PERFORM pg_temp.expect_error(format('INSERT INTO workify.complaints (order_id, customer_id, freelancer_id, reporter_id, target_id, reason, description) VALUES (%L, %L, %L, %L, %L, ''deadline'', ''Дубль'')', first_order, customer, freelancer, customer, freelancer), '23505', 'one complaint per author and order');
    PERFORM pg_temp.expect_error(format('UPDATE workify.complaints SET status = ''RESOLVED'' WHERE id = %L', complaint), '23514', 'resolved complaint requires assigned admin and reason');

    INSERT INTO workify.moderation_actions (id, complaint_id, admin_id, target_id, action_type, reason)
        VALUES (warning_action, complaint, administrator, freelancer, 'WARNING', 'Предупреждение исполнителю');
    INSERT INTO workify.moderation_actions (complaint_id, admin_id, target_id, action_type, reason)
        VALUES (complaint, administrator, customer, 'WARNING', 'Предупреждение заказчику');
    PERFORM pg_temp.assert_true((SELECT count(*) = 2 FROM workify.moderation_actions WHERE complaint_id = complaint), 'sanctions can apply to both parties');
    INSERT INTO workify.warnings (moderation_action_id, user_id, issued_by, message)
        VALUES (warning_action, freelancer, administrator, 'Предупреждение');
    PERFORM pg_temp.expect_error(format('INSERT INTO workify.warnings (moderation_action_id, user_id, issued_by, message) VALUES (%L, %L, %L, ''Дубль'')', warning_action, freelancer, administrator), '23505', 'one warning per action');
    INSERT INTO workify.moderation_actions (id, admin_id, target_id, action_type, reason)
        VALUES (block_action, administrator, freelancer, 'PERMANENT_BLOCK', 'Блокировка');
    PERFORM pg_temp.expect_error(format('INSERT INTO workify.warnings (moderation_action_id, user_id, issued_by, message) VALUES (%L, %L, %L, ''Неверный тип'')', block_action, freelancer, administrator), '23503', 'warning references WARNING action only');
    PERFORM pg_temp.expect_error(format('INSERT INTO workify.moderation_actions (admin_id, target_id, action_type, reason) VALUES (%L, %L, ''TEMPORARY_BLOCK'', ''Нет срока'')', administrator, freelancer), '23514', 'temporary block has expiration');

    INSERT INTO workify.stored_files (id, uploaded_by, storage_key, original_name, mime_type, size_bytes)
        VALUES (stored_file, freelancer, 'safe-result.pdf', 'Отчёт.pdf', 'application/pdf', 100);
    INSERT INTO workify.submission_files (submission_id, file_id) VALUES (submission, stored_file);
    PERFORM pg_temp.expect_error(format('UPDATE workify.stored_files SET storage_key = ''../escape.pdf'' WHERE id = %L', stored_file), '23514', 'storage key cannot traverse directories');
    PERFORM pg_temp.expect_error(format('DELETE FROM workify.stored_files WHERE id = %L', stored_file), '23503', 'referenced result file cannot be deleted');
    PERFORM pg_temp.expect_error(format('INSERT INTO workify.notifications (recipient_id, event_type, order_id, message) VALUES (%L, ''ORDER_CREATED'', %L, ''Сообщение'')', customer, gen_random_uuid()), '23503', 'notification has real entity link');

    INSERT INTO workify.audit_logs (id, actor_id, action, entity_type, entity_id) VALUES (audit_entry, customer, 'TEST', 'order', first_order);
    INSERT INTO workify.order_events (id, order_id, actor_id, event_type) VALUES (event_entry, first_order, customer, 'ORDER_CANCELLED');
    PERFORM pg_temp.expect_error(format('UPDATE workify.audit_logs SET action = ''HIDDEN'' WHERE id = %L', audit_entry), '23514', 'audit append only');
    PERFORM pg_temp.expect_error(format('DELETE FROM workify.order_events WHERE id = %L', event_entry), '23514', 'order timeline append only');
    PERFORM pg_temp.expect_error('TRUNCATE workify.audit_logs', '23514', 'audit cannot be truncated');
    PERFORM pg_temp.expect_error(format('DELETE FROM workify.moderation_actions WHERE id = %L', block_action), '23514', 'moderation history append only');
    PERFORM pg_temp.expect_error(format('DELETE FROM workify.users WHERE id = %L', customer), '23503', 'users with history cannot be deleted');
END;
$$;
SELECT format('PASS: %s schema constraint assertions (fixtures rolled back)', count(*)) FROM test_results;
ROLLBACK;
